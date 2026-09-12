// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IBond3643} from "../interfaces/IBond3643.sol";
import {IATSBond} from "../interfaces/IATSBond.sol";
import {WadMath} from "../libraries/WadMath.sol";

/// @notice Cash settlement venue for a separately issued, real ATS v4 bond.
/// @dev The issuer supplies ATS inventory and cash. Purchases transfer ATS tokens;
///      redemptions are funded buybacks, NOT a claim that ATS burn pays cash.
///      Coupon cash is segregated and paid using ATS record-date entitlements.
///      One market strategy may buy, redeem and claim. No admin cash withdrawal.
///      Terms and coupon schedule are pinned at deployment; changes fail closed.
contract ATSBondAdapter is IBond3643, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IATSBond public immutable ats;
    address public immutable securityToken;
    address public immutable denominationAsset;
    uint256 public immutable cashUnit;
    uint256 public immutable bondUnit;
    uint256 public immutable startTime;
    uint256 public immutable maturityTime;
    uint256 public immutable issuePricePerUnit;
    uint256 public immutable faceValuePerUnit;
    bytes32 public immutable termsHash;
    uint256 public immutable couponCount;
    uint256 public constant MAX_COUPONS = 32;
    bytes32 public constant DEFAULT_PARTITION = bytes32(uint256(1));

    address public strategy;
    uint256 public principalReserve;
    mapping(uint256 => uint256) public couponReserve;
    mapping(uint256 => uint256) public couponFunding;
    mapping(uint256 => bool) public couponClaimed;
    mapping(uint256 => bytes32) public couponTermsHash;

    error InvalidConfiguration();
    error UnsupportedTerms();
    error NotStrategy();
    error NotEligible(address account);
    error InvalidAmount();
    error InsufficientReserve();
    error CouponNotDue();

    event StrategyBound(address indexed strategy);
    event PrincipalFunded(uint256 amount);
    event CouponFunded(uint256 indexed id, uint256 amount);
    event Purchased(address indexed buyer, uint256 cash, uint256 bonds);
    event BoughtBack(address indexed seller, uint256 bonds, uint256 cash);
    event CouponPaid(uint256 indexed id, address indexed holder, uint256 cash);

    constructor(address security_, address cash_, address issuer_, uint256 issuePrice_)
        Ownable(issuer_)
    {
        if (security_.code.length == 0 || cash_.code.length == 0 || security_ == cash_) {
            revert InvalidConfiguration();
        }
        ats = IATSBond(security_);
        securityToken = security_;
        denominationAsset = cash_;
        uint8 cashDecimals = IERC20Metadata(cash_).decimals();
        uint8 bondDecimals = IERC20Metadata(security_).decimals();
        if (cashDecimals > 18 || bondDecimals > 18) revert UnsupportedTerms();
        cashUnit = 10 ** cashDecimals;
        bondUnit = 10 ** bondDecimals;
        IATSBond.BondDetailsData memory terms = ats.getBondDetails();
        if (
            terms.nominalValueDecimals > 18 || terms.maturityDate <= block.timestamp
                || terms.maturityDate <= terms.startingDate || terms.currency != bytes3("USD")
        ) revert UnsupportedTerms();
        uint256 face =
            WadMath.mulDivDown(terms.nominalValue, cashUnit, 10 ** terms.nominalValueDecimals);
        if (face == 0 || issuePrice_ == 0 || issuePrice_ > face) revert UnsupportedTerms();
        faceValuePerUnit = face;
        issuePricePerUnit = issuePrice_;
        startTime = terms.startingDate;
        maturityTime = terms.maturityDate;
        termsHash = keccak256(abi.encode(terms));
        uint256 count = ats.getCouponCount();
        if (count > MAX_COUPONS) revert UnsupportedTerms();
        couponCount = count;
        for (uint256 i; i < count; i++) {
            IATSBond.Coupon memory coupon = ats.getCoupon(i + 1).coupon;
            if (
                coupon.recordDate <= block.timestamp || coupon.recordDate >= coupon.executionDate
                    || coupon.executionDate > terms.maturityDate || coupon.rateStatus != 1
            ) revert UnsupportedTerms();
            couponTermsHash[i] = keccak256(abi.encode(coupon));
        }
    }

    function bindStrategy(address strategy_) external onlyOwner {
        if (strategy != address(0) || strategy_.code.length == 0) revert InvalidConfiguration();
        strategy = strategy_;
        emit StrategyBound(strategy_);
    }

    function denomination() external view returns (address) {
        return denominationAsset;
    }

    function maturityDate() external view returns (uint256) {
        return maturityTime;
    }

    function maturity() external view returns (uint256) {
        return maturityTime;
    }

    function startDate() external view returns (uint256) {
        return startTime;
    }

    function nominalValue() external view returns (uint256) {
        return faceValuePerUnit;
    }

    function isMatured() public view returns (bool) {
        return block.timestamp >= maturityTime;
    }

    function totalSupply() external view returns (uint256) {
        return IERC20(securityToken).totalSupply();
    }

    function balanceOf(address holder) external view returns (uint256) {
        return IERC20(securityToken).balanceOf(holder);
    }

    function couponValuePerUnit() external pure returns (uint256) {
        return 0;
    }

    function isVerified(address holder) public view returns (bool) {
        // ATS full-address freeze changes the control list. Partial freezes and
        // recovery are conservatively treated as ineligible for market claims.
        return !ats.isPaused() && ats.getKycStatusFor(holder) == 1
            && ats.isInControlList(holder) == ats.getControlListType()
            && !ats.isAddressRecovered(holder) && ats.getFrozenTokens(holder) == 0;
    }

    function valuePerUnit() public view returns (uint256) {
        _validateTerms();
        if (block.timestamp <= startTime) return issuePricePerUnit;
        if (isMatured()) return faceValuePerUnit;
        return issuePricePerUnit
            + WadMath.mulDivDown(
            faceValuePerUnit - issuePricePerUnit,
            block.timestamp - startTime,
            maturityTime - startTime
        );
    }

    function valueOf(uint256 bonds) external view returns (uint256) {
        return WadMath.mulDivDown(bonds, valuePerUnit(), bondUnit);
    }

    function availableLiquidity() external view returns (uint256) {
        return principalReserve;
    }

    function fundPrincipal(uint256 amount) external onlyOwner nonReentrant {
        _pullCash(msg.sender, amount);
        principalReserve += amount;
        emit PrincipalFunded(amount);
    }

    function fundCoupon(uint256 id, uint256 amount) external onlyOwner nonReentrant {
        IATSBond.Coupon memory coupon = _coupon(id);
        if (block.timestamp >= coupon.recordDate) revert CouponNotDue();
        _pullCash(msg.sender, amount);
        couponReserve[id] += amount;
        couponFunding[id] += amount;
        emit CouponFunded(id, amount);
    }

    function purchase(uint256 cashIn) external nonReentrant returns (uint256 bonds) {
        _checkStrategy();
        if (isMatured()) revert UnsupportedTerms();
        bonds = WadMath.mulDivDown(cashIn, bondUnit, valuePerUnit());
        if (bonds == 0) revert InvalidAmount();
        _pullCash(msg.sender, cashIn);
        principalReserve += cashIn;
        uint256 beforeBalance = IERC20(securityToken).balanceOf(msg.sender);
        IERC20(securityToken).safeTransfer(msg.sender, bonds);
        if (IERC20(securityToken).balanceOf(msg.sender) - beforeBalance != bonds) {
            revert InvalidAmount();
        }
        emit Purchased(msg.sender, cashIn, bonds);
    }

    function redeem(uint256 bonds) public nonReentrant returns (uint256 cash) {
        _checkStrategy();
        cash = WadMath.mulDivDown(bonds, valuePerUnit(), bondUnit);
        if (cash == 0) revert InvalidAmount();
        if (cash > principalReserve) revert InsufficientReserve();
        principalReserve -= cash;
        uint256 beforeBalance = IERC20(securityToken).balanceOf(address(this));
        IERC20(securityToken).safeTransferFrom(msg.sender, address(this), bonds);
        if (IERC20(securityToken).balanceOf(address(this)) - beforeBalance != bonds) {
            revert InvalidAmount();
        }
        IERC20(denominationAsset).safeTransfer(msg.sender, cash);
        emit BoughtBack(msg.sender, bonds, cash);
    }

    function redeemAtMaturity(uint256 bonds) external returns (uint256) {
        if (!isMatured()) revert UnsupportedTerms();
        return redeem(bonds);
    }

    function couponInfo(uint256 id) external view returns (CouponInfo memory info) {
        IATSBond.Coupon memory coupon = _coupon(id);
        info = CouponInfo(
            coupon.recordDate, coupon.executionDate, coupon.rate, couponFunding[id], 0, true
        );
    }

    function couponBalance(uint256 id, address holder) external view returns (uint256) {
        _coupon(id);
        return ats.getCouponFor(id + 1, holder).tokenBalance;
    }

    function accruedCoupon(uint256 id, address holder) public view returns (uint256) {
        _coupon(id);
        if (holder != strategy || holder == address(0) || couponClaimed[id]) return 0;
        IATSBond.CouponAmountFor memory entitlement = ats.getCouponAmountFor(id + 1, holder);
        if (!entitlement.recordDateReached) return 0;
        if (entitlement.denominator == 0) revert UnsupportedTerms();
        uint256 cash = WadMath.mulDivDown(entitlement.numerator, cashUnit, entitlement.denominator);
        // Underfunding must be repaired before the record date. Fail closed;
        // never subsidize coupon entitlement from principal or change NAV by claim order.
        if (cash > couponReserve[id]) revert InsufficientReserve();
        return cash;
    }

    function claimableCoupon(uint256 id, address holder) public view returns (uint256) {
        if (block.timestamp < _coupon(id).executionDate) return 0;
        return accruedCoupon(id, holder);
    }

    function claimCoupon(uint256 id) external nonReentrant returns (uint256 cash) {
        _checkStrategy();
        cash = claimableCoupon(id, msg.sender);
        if (cash == 0) revert CouponNotDue();
        couponClaimed[id] = true;
        couponReserve[id] -= cash;
        IERC20(denominationAsset).safeTransfer(msg.sender, cash);
        emit CouponPaid(id, msg.sender, cash);
    }

    function accrue() external {
        _validateTerms();
        // Use ATS's own scheduled snapshots before reading or moving positions.
        if (strategy == address(0)) revert InvalidConfiguration();
        ats.triggerAndSyncAll(DEFAULT_PARTITION, strategy, address(this));
    }

    function _coupon(uint256 id) internal view returns (IATSBond.Coupon memory coupon) {
        _validateTerms();
        if (id >= couponCount) revert InvalidAmount();
        coupon = ats.getCoupon(id + 1).coupon;
        if (keccak256(abi.encode(coupon)) != couponTermsHash[id]) revert UnsupportedTerms();
    }

    function _validateTerms() internal view {
        if (
            keccak256(abi.encode(ats.getBondDetails())) != termsHash
                || ats.getCouponCount() != couponCount
        ) {
            revert UnsupportedTerms();
        }
    }

    function _checkStrategy() internal view {
        if (msg.sender != strategy || strategy == address(0)) revert NotStrategy();
        if (!isVerified(strategy)) revert NotEligible(strategy);
        if (!isVerified(address(this))) revert NotEligible(address(this));
    }

    function _pullCash(address from, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = IERC20(denominationAsset).balanceOf(address(this));
        IERC20(denominationAsset).safeTransferFrom(from, address(this), amount);
        if (IERC20(denominationAsset).balanceOf(address(this)) - beforeBalance != amount) {
            revert InvalidAmount();
        }
    }
}
