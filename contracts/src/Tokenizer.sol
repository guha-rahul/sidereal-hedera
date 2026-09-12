// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStandardizedYield} from "./interfaces/IStandardizedYield.sol";
import {IYieldToken} from "./interfaces/IYieldToken.sol";
import {IProtocolToken} from "./interfaces/IProtocolToken.sol";
import {WadMath} from "./libraries/WadMath.sol";

/// @title Tokenizer
/// @notice Mints PT + YT from SY, escrows the SY, and prices principal and
///         yield at maturity.
/// @dev PT and YT are denominated in
///      asset units, not SY shares: `face = sy_amount * rate / WAD`, so 1 PT is
///      always a claim on 1 unit of asset at maturity regardless of when it was
///      minted. The escrow-coverage invariant is priced at redemption (pro-rata
///      cap) rather than blocked, matching Pendle.
contract Tokenizer {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    struct Config {
        address admin;
        address syToken;
        address ptToken;
        address ytToken;
        uint256 maturity;
        address feeRecipient;
        uint256 yieldFeeBps;
    }

    Config public config;
    bool private _initialized;
    address private immutable _initializer = msg.sender;

    /// @dev SY rate frozen at maturity.
    uint256 public maturityRate;
    /// @dev Most recent pre-maturity SY rate observed by a mutating call.
    uint256 public lastObservedRate;

    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant MAX_YIELD_FEE_BPS = 2_000;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidMaturity();
    error InvalidAmount();
    error AmountMismatch();
    error Matured();
    error LiveMarket();
    error InvalidFee();
    error NotAdmin();
    error InvalidFeeRecipient();
    error MathOverflow();
    error InvalidConfiguration();
    error SettlementPending();

    event YieldFeeSet(address indexed admin, uint256 oldFeeBps, uint256 newFeeBps);
    event Split(address indexed from, uint256 syIn, uint256 ptOut, uint256 ytOut, uint256 rate);
    event Recombined(address indexed from, uint256 ptIn, uint256 ytIn, uint256 syOut, uint256 rate);
    event RedeemedAtMaturity(address indexed from, uint256 ptIn, uint256 syOut, uint256 rate);
    event YieldClaimed(address indexed holder, uint256 pay, uint256 fee, uint256 net);

    modifier initialized() {
        if (!_initialized) revert NotInitialized();
        _;
    }

    function initialize(
        address admin,
        address syToken,
        address ptToken,
        address ytToken,
        uint256 maturity_,
        address feeRecipient,
        uint256 yieldFeeBps_
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (msg.sender != _initializer || admin == address(0)) revert InvalidConfiguration();
        if (IStandardizedYield(syToken).maturity() != maturity_) revert InvalidMaturity();
        if (maturity_ <= block.timestamp) revert InvalidMaturity();
        if (yieldFeeBps_ > MAX_YIELD_FEE_BPS) revert InvalidFee();
        if (
            feeRecipient == address(this) || feeRecipient == syToken || feeRecipient == ptToken
                || feeRecipient == ytToken
        ) {
            revert InvalidFeeRecipient();
        }
        _initialized = true;
        config = Config({
            admin: admin,
            syToken: syToken,
            ptToken: ptToken,
            ytToken: ytToken,
            maturity: maturity_,
            feeRecipient: feeRecipient,
            yieldFeeBps: yieldFeeBps_
        });
    }

    function maturity() public view returns (uint256) {
        return config.maturity;
    }

    function isMatured() public view returns (bool) {
        return block.timestamp >= config.maturity;
    }

    function yieldFeeBps() external view returns (uint256) {
        return config.yieldFeeBps;
    }

    /// @notice Updates the protocol cut of claimed yield. Admin only.
    function setFee(address admin, uint256 yieldFeeBps_) external initialized {
        if (msg.sender != config.admin || admin != config.admin) revert NotAdmin();
        if (yieldFeeBps_ > MAX_YIELD_FEE_BPS) revert InvalidFee();
        if (
            yieldFeeBps_ > 0
                && (config.feeRecipient == address(this)
                    || config.feeRecipient == config.syToken
                    || config.feeRecipient == config.ptToken
                    || config.feeRecipient == config.ytToken)
        ) {
            revert InvalidFeeRecipient();
        }
        uint256 old = config.yieldFeeBps;
        config.yieldFeeBps = yieldFeeBps_;
        emit YieldFeeSet(admin, old, yieldFeeBps_);
    }

    // --- rate observation ---------------------------------------------------

    /// @notice Permissionless: records the live SY rate as the latest pre-maturity
    ///         observation the maturity freeze may use.
    function observeRate() external initialized returns (uint256) {
        _requireLive();
        return _observeLiveRate();
    }

    /// @notice Permissionless: snapshots and returns the rate used for all
    ///         post-maturity redemption. Idempotent.
    function freezeMaturityRate() external initialized returns (uint256) {
        if (!isMatured()) revert LiveMarket();
        return _effectiveRate();
    }

    /// @notice The rate to value escrow at: live before maturity, frozen after.
    function effectiveRate() external initialized returns (uint256) {
        return _effectiveRate();
    }

    // --- previews -----------------------------------------------------------

    function previewSplit(uint256 syAmount)
        external
        view
        initialized
        returns (uint256 ptOut, uint256 ytOut)
    {
        if (isMatured()) revert Matured();
        if (syAmount == 0) revert InvalidAmount();
        uint256 rate = IStandardizedYield(config.syToken).exchangeRate();
        uint256 face = WadMath.mulDivDown(syAmount, rate, WadMath.WAD);
        if (face == 0) revert InvalidAmount();
        return (face, face);
    }

    function previewRecombine(uint256 ptAmount, uint256 ytAmount)
        external
        view
        initialized
        returns (uint256)
    {
        if (isMatured()) revert Matured();
        if (ptAmount == 0 || ytAmount == 0) revert InvalidAmount();
        if (ptAmount != ytAmount) revert AmountMismatch();
        uint256 rate = IStandardizedYield(config.syToken).exchangeRate();
        uint256 full = WadMath.mulDivDown(ptAmount, WadMath.WAD, rate);
        uint256 escrowShares = IERC20(config.syToken).balanceOf(address(this));
        uint256 ptSupply = IProtocolToken(config.ptToken).totalSupply();
        uint256 proRata = WadMath.mulDivDown(escrowShares, ptAmount, ptSupply);
        return full < proRata ? full : proRata;
    }

    function position(address holder)
        external
        view
        initialized
        returns (uint256 ptBalance, uint256 ytBalance)
    {
        return (
            IProtocolToken(config.ptToken).balanceOf(holder),
            IProtocolToken(config.ytToken).balanceOf(holder)
        );
    }

    function escrowedSy() external view initialized returns (uint256) {
        return IERC20(config.syToken).balanceOf(address(this));
    }

    /// @notice SY shares available to junior YT claims after reserving escrow for
    ///         every outstanding PT.
    function availableYieldSurplus() external view initialized returns (uint256) {
        uint256 rate = _effectiveRateView();
        return _juniorSurplus(rate);
    }

    // --- core lifecycle -----------------------------------------------------

    /// @notice Pulls `syAmount` SY from the caller into escrow and mints equal PT
    ///         and YT, denominated in asset units.
    function split(uint256 syAmount) external initialized returns (uint256 ptOut, uint256 ytOut) {
        _requireLive();
        if (syAmount == 0) revert InvalidAmount();
        uint256 rate = _observeLiveRate();
        uint256 face = WadMath.mulDivDown(syAmount, rate, WadMath.WAD);
        if (face == 0) revert InvalidAmount();

        IERC20(config.syToken).safeTransferFrom(msg.sender, address(this), syAmount);
        IProtocolToken(config.ptToken).mint(msg.sender, face);
        IYieldToken(config.ytToken).mint(msg.sender, face);
        emit Split(msg.sender, syAmount, face, face, rate);
        return (face, face);
    }

    /// @notice Burns equal PT and YT from the caller and returns principal in SY
    ///         shares, capped pro-rata under a shortfall.
    function recombine(uint256 ptAmount, uint256 ytAmount)
        external
        initialized
        returns (uint256 syOut)
    {
        _requireLive();
        if (ptAmount == 0 || ytAmount == 0) revert InvalidAmount();
        if (ptAmount != ytAmount) revert AmountMismatch();

        uint256 rate = _observeLiveRate();
        uint256 full = WadMath.mulDivDown(ptAmount, WadMath.WAD, rate);

        uint256 escrowShares = IERC20(config.syToken).balanceOf(address(this));
        uint256 ptSupply = IProtocolToken(config.ptToken).totalSupply();
        uint256 proRata = WadMath.mulDivDown(escrowShares, ptAmount, ptSupply);
        syOut = full < proRata ? full : proRata;
        if (syOut == 0) revert InvalidAmount();

        IProtocolToken(config.ptToken).burnFrom(msg.sender, ptAmount);
        // YT is burned through the tokenizer-gated burnSetSettled, handing down
        // the same rate observed above so the settle banks consistently.
        IYieldToken(config.ytToken).burnSetSettled(msg.sender, ytAmount, rate);
        IERC20(config.syToken).safeTransfer(msg.sender, syOut);
        emit Recombined(msg.sender, ptAmount, ytAmount, syOut, rate);
    }

    /// @notice After maturity, burns PT and returns principal in SY shares,
    ///         capped to the holder's pro-rata share of escrow.
    function redeemAtMaturity(uint256 ptAmount) external initialized returns (uint256 syOut) {
        if (!isMatured()) revert LiveMarket();
        if (ptAmount == 0) revert InvalidAmount();

        uint256 rate = _effectiveRate();
        uint256 full = WadMath.mulDivDown(ptAmount, WadMath.WAD, rate);
        uint256 escrowShares = IERC20(config.syToken).balanceOf(address(this));
        uint256 ptSupply = IProtocolToken(config.ptToken).totalSupply();
        uint256 proRata = WadMath.mulDivDown(escrowShares, ptAmount, ptSupply);
        syOut = full < proRata ? full : proRata;
        if (syOut == 0) revert InvalidAmount();

        IProtocolToken(config.ptToken).burnFrom(msg.sender, ptAmount);
        IERC20(config.syToken).safeTransfer(msg.sender, syOut);
        emit RedeemedAtMaturity(msg.sender, ptAmount, syOut, rate);
    }

    /// @notice Pays the caller their accrued YT yield in SY, senior to nothing
    ///         but PT principal: the payout is capped by the junior surplus.
    function claimYield() external initialized returns (uint256 net) {
        uint256 rate = _effectiveRate();
        uint256 owed = IYieldToken(config.ytToken).settle(msg.sender, rate);
        uint256 surplus = _juniorSurplus(rate);
        uint256 pay = owed < surplus ? owed : surplus;
        uint256 fee = WadMath.mulDivDown(pay, config.yieldFeeBps, BPS_DENOMINATOR);
        net = pay - fee;

        if (pay > 0) {
            IYieldToken(config.ytToken).consume(msg.sender, pay);
            if (net > 0) IERC20(config.syToken).safeTransfer(msg.sender, net);
            if (fee > 0) IERC20(config.syToken).safeTransfer(config.feeRecipient, fee);
        }
        emit YieldClaimed(msg.sender, pay, fee, net);
    }

    // --- internals ----------------------------------------------------------

    function _requireLive() internal view {
        if (isMatured()) revert Matured();
    }

    function _currentRate() internal view returns (uint256) {
        return IStandardizedYield(config.syToken).exchangeRate();
    }

    /// @dev Reads the live SY rate and records it as the latest pre-maturity
    ///      observation.
    function _observeLiveRate() internal returns (uint256 rate) {
        IStandardizedYield(config.syToken).touch();
        rate = _currentRate();
        lastObservedRate = rate;
    }

    /// @dev Bond strategies stop principal accrual at their matched maturity and
    ///      include record-date coupon receivables in NAV. Synchronize coupon cash
    ///      before the terminal rate is frozen; no keeper observation is required.
    ///      New strategy types must enforce a terminal NAV before reporting ready.
    function _effectiveRate() internal returns (uint256 rate) {
        if (!isMatured()) {
            return _observeLiveRate();
        }
        uint256 frozen = maturityRate;
        if (frozen > 0) return frozen;
        IStandardizedYield sy = IStandardizedYield(config.syToken);
        sy.touch();
        if (!sy.settlementReady()) revert SettlementPending();
        rate = _currentRate();
        maturityRate = rate;
    }

    /// @dev View-only variant for previews; cannot snapshot.
    function _effectiveRateView() internal view returns (uint256) {
        if (!isMatured()) return _currentRate();
        uint256 frozen = maturityRate;
        if (frozen > 0) return frozen;
        if (!IStandardizedYield(config.syToken).settlementReady()) revert SettlementPending();
        return _currentRate();
    }

    function _juniorSurplus(uint256 rate) internal view returns (uint256) {
        uint256 escrowShares = IERC20(config.syToken).balanceOf(address(this));
        uint256 ptSupply = IProtocolToken(config.ptToken).totalSupply();
        uint256 reservation = WadMath.mulDivUp(ptSupply, WadMath.WAD, rate);
        return escrowShares > reservation ? escrowShares - reservation : 0;
    }
}
