// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {WadMath} from "./libraries/WadMath.sol";

/// @title Orderbook
/// @notice Resting limit-order book for PT (base) against SY (quote), deployed
///         beside each AMM market.
/// @dev Orders live in doubly linked
///      lists sorted by price then insertion time. A maker supplies the intended
///      predecessor and the contract validates both local neighbors, so
///      placement is bounded while the list head remains the only fillable
///      order: price-time priority cannot be bypassed. Marketable orders are
///      rejected; callers fill the best opposite order first.
contract Orderbook {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    enum Side {
        Ask,
        Bid
    }

    struct Config {
        address admin;
        address ptToken;
        address syToken;
        uint256 maturity;
        address feeRecipient;
        uint256 takerFeeBps;
    }

    struct Order {
        uint64 id;
        address maker;
        Side side;
        uint256 priceWad;
        uint256 originalBase;
        uint256 remainingBase;
        uint256 escrowRemaining;
        uint256 expiry;
        uint256 createdAt;
        uint64 prev;
        uint64 next;
        bool exists;
    }

    struct FillReceipt {
        uint64 orderId;
        address maker;
        address taker;
        Side side;
        uint256 baseFilled;
        uint256 quoteAmount;
        uint256 takerFee;
        uint256 remainingBase;
    }

    Config public config;
    bool private _initialized;
    address private immutable _initializer = msg.sender;
    uint64 public askHead;
    uint64 public bidHead;
    uint64 public nextOrderId;
    uint64 public openCount;
    mapping(uint64 => Order) internal orders;

    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant MAX_TAKER_FEE_BPS = 1_000;
    uint32 internal constant MAX_PAGE_SIZE = 50;
    uint256 internal constant MAX_ORDER_LIFETIME_SECONDS = 90 days;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidMaturity();
    error InvalidAmount();
    error InvalidPrice();
    error InvalidExpiry();
    error InvalidFee();
    error NotAdmin();
    error OrderNotFound();
    error NotMaker();
    error WrongSide();
    error InvalidPredecessor();
    error OrderWouldCross();
    error NotBestOrder();
    error LimitPriceExceeded();
    error OrderExpired();
    error MarketMatured();
    error MathOverflow();
    error PageTooLarge();
    error InvalidFeeRecipient();

    event OrderPlaced(
        uint64 indexed id,
        address indexed maker,
        Side side,
        uint256 priceWad,
        uint256 baseAmount,
        uint256 expiry
    );
    event OrderFilled(
        uint64 indexed id,
        address indexed maker,
        address indexed taker,
        uint256 baseFilled,
        uint256 quoteAmount,
        uint256 takerFee,
        uint256 remainingBase
    );
    event OrderCancelled(uint64 indexed id, address indexed maker, uint256 remainingBase, bool expired);
    event FeeSet(address indexed admin, uint256 oldFeeBps, uint256 newFeeBps);

    function initialize(
        address admin,
        address ptToken,
        address syToken,
        uint256 maturity_,
        address feeRecipient,
        uint256 takerFeeBps
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (msg.sender != _initializer) revert NotAdmin();
        if (maturity_ <= block.timestamp) revert InvalidMaturity();
        _requireFee(takerFeeBps);
        if (feeRecipient == address(this) || feeRecipient == ptToken || feeRecipient == syToken) {
            revert InvalidFeeRecipient();
        }
        _initialized = true;
        config = Config({
            admin: admin,
            ptToken: ptToken,
            syToken: syToken,
            maturity: maturity_,
            feeRecipient: feeRecipient,
            takerFeeBps: takerFeeBps
        });
        nextOrderId = 1;
    }

    function maturity() external view returns (uint256) {
        return config.maturity;
    }

    function setFee(address admin, uint256 takerFeeBps) external {
        Config memory c = _readConfig();
        if (msg.sender != c.admin || admin != c.admin) revert NotAdmin();
        _requireFee(takerFeeBps);
        if (
            takerFeeBps > 0
                && (
                    c.feeRecipient == address(this) || c.feeRecipient == c.ptToken
                        || c.feeRecipient == c.syToken
                )
        ) {
            revert InvalidFeeRecipient();
        }
        uint256 old = c.takerFeeBps;
        config.takerFeeBps = takerFeeBps;
        emit FeeSet(admin, old, takerFeeBps);
    }

    function getOrder(uint64 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function bestOrder(Side side) external view returns (Order memory) {
        uint64 id = _head(side);
        return orders[id];
    }

    function listOrders(
        Side side,
        uint64 cursor,
        uint32 limit
    ) external view returns (Order[] memory) {
        _readConfig();
        if (limit == 0 || limit > MAX_PAGE_SIZE) revert PageTooLarge();

        uint64 next;
        if (cursor != 0) {
            Order memory order = orders[cursor];
            if (!order.exists) revert OrderNotFound();
            if (order.side != side) revert WrongSide();
            next = order.next;
        } else {
            next = _head(side);
        }

        Order[] memory page = new Order[](limit);
        uint32 count = 0;
        while (count < limit && next != 0) {
            Order memory order = orders[next];
            if (!order.exists) revert OrderNotFound();
            page[count] = order;
            next = order.next;
            count += 1;
        }
        // Trim to the actual count.
        Order[] memory trimmed = new Order[](count);
        for (uint32 i = 0; i < count; i++) {
            trimmed[i] = page[i];
        }
        return trimmed;
    }

    // --- placement ----------------------------------------------------------

    function placeOrder(
        Side side,
        uint256 baseAmount,
        uint256 priceWad,
        uint256 expiry,
        uint64 predecessor
    ) external returns (uint64 id) {
        Config memory c = _readLiveConfig();
        if (baseAmount == 0) revert InvalidAmount();
        if (priceWad == 0) revert InvalidPrice();
        uint256 now_ = block.timestamp;
        if (expiry <= now_ || expiry > c.maturity || expiry - now_ > MAX_ORDER_LIFETIME_SECONDS) {
            revert InvalidExpiry();
        }
        _rejectCrossingOrder(side, priceWad);

        uint64 current = nextOrderId;
        id = current;
        nextOrderId = current + 1;

        (uint64 prev, uint64 next) = _insertionNeighbors(side, priceWad, predecessor);
        uint256 escrowRemaining = side == Side.Ask ? baseAmount : _cumulativeQuote(baseAmount, priceWad);
        if (escrowRemaining == 0) revert InvalidAmount();

        address escrowToken = side == Side.Ask ? c.ptToken : c.syToken;
        IERC20(escrowToken).safeTransferFrom(msg.sender, address(this), escrowRemaining);

        orders[id] = Order({
            id: id,
            maker: msg.sender,
            side: side,
            priceWad: priceWad,
            originalBase: baseAmount,
            remainingBase: baseAmount,
            escrowRemaining: escrowRemaining,
            expiry: expiry,
            createdAt: now_,
            prev: prev,
            next: next,
            exists: true
        });
        _linkOrder(orders[id]);
        openCount += 1;
        emit OrderPlaced(id, msg.sender, side, priceWad, baseAmount, expiry);
    }

    function fillBest(
        Side restingSide,
        uint256 baseAmount,
        uint256 limitPriceWad
    ) external returns (FillReceipt memory receipt) {
        Config memory c = _readLiveConfig();
        if (baseAmount == 0) revert InvalidAmount();
        if (limitPriceWad == 0) revert InvalidPrice();

        uint64 id = _head(restingSide);
        if (id == 0) revert OrderNotFound();
        Order storage order = orders[id];
        if (!order.exists) revert OrderNotFound();
        if (order.side != restingSide) revert WrongSide();
        if (order.expiry <= block.timestamp) revert OrderExpired();

        if (restingSide == Side.Ask && order.priceWad > limitPriceWad) revert LimitPriceExceeded();
        if (restingSide == Side.Bid && order.priceWad < limitPriceWad) revert LimitPriceExceeded();
        if (baseAmount > order.remainingBase) revert InvalidAmount();

        uint256 filledBefore = order.originalBase - order.remainingBase;
        uint256 quoteBefore = _cumulativeQuote(filledBefore, order.priceWad);
        uint256 quoteAfter = _cumulativeQuote(filledBefore + baseAmount, order.priceWad);
        uint256 quoteAmount = quoteAfter - quoteBefore;
        if (quoteAmount == 0) revert InvalidAmount();

        uint256 takerFee = WadMath.mulDivDown(quoteAmount, c.takerFeeBps, BPS_DENOMINATOR);

        if (restingSide == Side.Ask) {
            uint256 totalDue = quoteAmount + takerFee;
            IERC20(c.syToken).safeTransferFrom(msg.sender, address(this), totalDue);
            IERC20(c.syToken).safeTransfer(order.maker, quoteAmount);
            if (takerFee > 0) IERC20(c.syToken).safeTransfer(c.feeRecipient, takerFee);
            IERC20(c.ptToken).safeTransfer(msg.sender, baseAmount);
            order.escrowRemaining -= baseAmount;
        } else {
            if (quoteAmount > order.escrowRemaining) revert MathOverflow();
            IERC20(c.ptToken).safeTransferFrom(msg.sender, address(this), baseAmount);
            IERC20(c.ptToken).safeTransfer(order.maker, baseAmount);
            IERC20(c.syToken).safeTransfer(msg.sender, quoteAmount - takerFee);
            if (takerFee > 0) IERC20(c.syToken).safeTransfer(c.feeRecipient, takerFee);
            order.escrowRemaining -= quoteAmount;
        }

        order.remainingBase -= baseAmount;
        uint256 remainingBase = order.remainingBase;
        if (remainingBase == 0) {
            _unlinkOrder(order);
            delete orders[id];
            openCount -= 1;
        }

        receipt = FillReceipt({
            orderId: id,
            maker: order.maker,
            taker: msg.sender,
            side: restingSide,
            baseFilled: baseAmount,
            quoteAmount: quoteAmount,
            takerFee: takerFee,
            remainingBase: remainingBase
        });
        emit OrderFilled(id, order.maker, msg.sender, baseAmount, quoteAmount, takerFee, remainingBase);
    }

    function cancelOrder(uint64 orderId) external {
        Config memory c = _readConfig();
        Order storage order = orders[orderId];
        if (!order.exists) revert OrderNotFound();
        if (order.maker != msg.sender) revert NotMaker();
        _closeOrder(c, order, false);
    }

    function pruneExpired(Side side, uint32 maxOrders) external returns (uint32 pruned) {
        Config memory c = _readConfig();
        if (maxOrders == 0 || maxOrders > MAX_PAGE_SIZE) revert PageTooLarge();
        while (pruned < maxOrders) {
            uint64 id = _head(side);
            if (id == 0) break;
            Order storage order = orders[id];
            if (!order.exists) revert OrderNotFound();
            if (order.expiry > block.timestamp) break;
            _closeOrder(c, order, true);
            pruned += 1;
        }
    }

    // --- internals ----------------------------------------------------------

    function _readConfig() internal view returns (Config memory) {
        if (!_initialized) revert NotInitialized();
        return config;
    }

    function _readLiveConfig() internal view returns (Config memory c) {
        c = _readConfig();
        if (block.timestamp >= c.maturity) revert MarketMatured();
    }

    function _requireFee(uint256 feeBps) internal pure {
        if (feeBps > MAX_TAKER_FEE_BPS) revert InvalidFee();
    }

    function _head(Side side) internal view returns (uint64) {
        return side == Side.Ask ? askHead : bidHead;
    }

    function _setHead(Side side, uint64 id) internal {
        if (side == Side.Ask) {
            askHead = id;
        } else {
            bidHead = id;
        }
    }

    function _insertionNeighbors(
        Side side,
        uint256 priceWad,
        uint64 predecessor
    ) internal view returns (uint64 prev, uint64 next) {
        uint64 successor;
        if (predecessor != 0) {
            Order memory previous = orders[predecessor];
            if (
                !previous.exists || previous.side != side
                    || !_orderedBefore(side, previous.priceWad, priceWad, false)
            ) {
                revert InvalidPredecessor();
            }
            successor = previous.next;
        } else {
            successor = _head(side);
        }
        if (successor != 0) {
            Order memory following = orders[successor];
            if (
                !following.exists || following.side != side
                    || !_orderedBefore(side, priceWad, following.priceWad, true)
            ) {
                revert InvalidPredecessor();
            }
        }
        return (predecessor, successor);
    }

    /// @dev `strict` forces new equal-price orders behind every existing order at
    ///      that price.
    function _orderedBefore(Side side, uint256 left, uint256 right, bool strict) internal pure returns (bool) {
        if (side == Side.Ask) {
            return strict ? left < right : left <= right;
        }
        return strict ? left > right : left >= right;
    }

    function _rejectCrossingOrder(Side side, uint256 priceWad) internal view {
        Side opposite = side == Side.Ask ? Side.Bid : Side.Ask;
        uint64 bestId = _head(opposite);
        if (bestId == 0) return;
        Order memory best = orders[bestId];
        if (!best.exists) return;
        bool crosses =
            side == Side.Ask ? priceWad <= best.priceWad : priceWad >= best.priceWad;
        if (crosses) revert OrderWouldCross();
    }

    function _linkOrder(Order storage order) internal {
        if (order.prev != 0) {
            orders[order.prev].next = order.id;
        } else {
            _setHead(order.side, order.id);
        }
        if (order.next != 0) {
            orders[order.next].prev = order.id;
        }
    }

    function _unlinkOrder(Order storage order) internal {
        if (order.prev != 0) {
            orders[order.prev].next = order.next;
        } else {
            _setHead(order.side, order.next);
        }
        if (order.next != 0) {
            orders[order.next].prev = order.prev;
        }
    }

    function _closeOrder(Config memory c, Order storage order, bool expired) internal {
        uint64 id = order.id;
        address maker = order.maker;
        Side side = order.side;
        uint256 escrowRemaining = order.escrowRemaining;
        uint256 remainingBase = order.remainingBase;
        _unlinkOrder(order);
        delete orders[id];
        openCount -= 1;
        address tokenId = side == Side.Ask ? c.ptToken : c.syToken;
        IERC20(tokenId).safeTransfer(maker, escrowRemaining);
        emit OrderCancelled(id, maker, remainingBase, expired);
    }

    function _cumulativeQuote(uint256 baseAmount, uint256 priceWad) internal pure returns (uint256) {
        if (baseAmount == 0) return 0;
        return WadMath.mulDivUp(baseAmount, priceWad, WadMath.WAD);
    }
}
