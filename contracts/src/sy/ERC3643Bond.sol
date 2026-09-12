// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC3643Base} from "../tokens/ERC3643Base.sol";
import {IBond3643} from "../interfaces/IBond3643.sol";
import {WadMath} from "../libraries/WadMath.sol";

/// @title ERC3643Bond
/// @notice Production-shaped tokenized bond: a permissioned ERC-3643 security
///         whose yield is paid as **cash** coupons by the issuer and whose
///         principal accretes to par for redemption at maturity.
/// @dev `valuePerUnit` reflects principal accretion only; coupons are separate,
///      issuer-funded cashflows that holders claim on/after each execution date. The issuer schedules
///      and funds coupons (`scheduleCoupon` / `fundCoupon`) and tops up the
///      redemption reserve (`fundPrincipal`); purchases also fund the reserve.
///
///      Coupon distribution uses a supply snapshot taken on the first claim:
///      the issuer funds `ratePerUnit * supply / WAD`, and each holder's share
///      is `fundedAmount * balance / snapshot`. The snapshot assumes no supply
///      change between the execution date and the first claim, which holds for
///      a permissioned bond whose holders do not churn around the record date.
contract ERC3643Bond is ERC3643Base, IBond3643 {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    address public immutable denominationAsset;
    uint256 public immutable startTime;
    uint256 public immutable maturityTime;
    uint256 public immutable issuePricePerUnit;
    uint256 public immutable nominalValuePerUnit;

    CouponInfo[] private _coupons;
    mapping(uint256 => mapping(address => bool)) public couponClaimed;

    error InvalidTerms();
    error InvalidAmount();
    error AlreadyMatured();
    error NotMatured();
    error InvalidSchedule();
    error CouponNotDue();
    error CouponAlreadyClaimed();
    error NothingToClaim();
    error InsufficientLiquidity();

    event Purchased(address indexed buyer, uint256 cashIn, uint256 bondOut);
    event Redeemed(address indexed holder, uint256 bondIn, uint256 cashOut);
    event RedeemedAtMaturity(address indexed holder, uint256 bondIn, uint256 cashOut);
    event CouponScheduled(uint256 indexed couponId, uint256 recordDate, uint256 executionDate, uint256 ratePerUnit);
    event CouponFunded(uint256 indexed couponId, uint256 amount);
    event PrincipalFunded(uint256 amount);
    event CouponClaimed(uint256 indexed couponId, address indexed holder, uint256 cashOut);

    constructor(
        address denomination_,
        address owner_,
        uint256 startTime_,
        uint256 maturityTime_,
        uint256 issuePricePerUnit_,
        uint256 nominalValuePerUnit_
    ) ERC3643Base("Tokenized Treasury Bond", "T-BOND", owner_) {
        if (denomination_ == address(0)) revert InvalidTerms();
        if (maturityTime_ <= startTime_) revert InvalidTerms();
        if (issuePricePerUnit_ == 0 || nominalValuePerUnit_ < issuePricePerUnit_) {
            revert InvalidTerms();
        }
        denominationAsset = denomination_;
        startTime = startTime_;
        maturityTime = maturityTime_;
        issuePricePerUnit = issuePricePerUnit_;
        nominalValuePerUnit = nominalValuePerUnit_;
    }

    // --- terms --------------------------------------------------------------

    function denomination() external view returns (address) {
        return denominationAsset;
    }

    function startDate() external view returns (uint256) {
        return startTime;
    }

    function maturityDate() external view returns (uint256) {
        return maturityTime;
    }

    function nominalValue() external view returns (uint256) {
        return nominalValuePerUnit;
    }

    function isMatured() public view returns (bool) {
        return block.timestamp >= maturityTime;
    }

    /// @notice Alias for `maturityDate`, matching the bond-reader ABI.
    function maturity() external view returns (uint256) {
        return maturityTime;
    }

    /// @notice Alias for `nominalValue`, matching the bond-reader ABI.
    function faceValuePerUnit() external view returns (uint256) {
        return nominalValuePerUnit;
    }

    /// @notice Capitalized coupon value per unit. Always zero here: this bond
    ///         pays coupons as cash, so they never enter `valuePerUnit`.
    function couponValuePerUnit() external pure returns (uint256) {
        return 0;
    }

    function valuePerUnit() public view returns (uint256) {
        if (block.timestamp <= startTime) return issuePricePerUnit;
        if (block.timestamp >= maturityTime) return nominalValuePerUnit;
        uint256 elapsed = block.timestamp - startTime;
        uint256 term = maturityTime - startTime;
        uint256 step = WadMath.mulDivDown(nominalValuePerUnit - issuePricePerUnit, elapsed, term);
        return issuePricePerUnit + step;
    }

    function valueOf(uint256 bondAmount) public view returns (uint256) {
        return WadMath.mulDivDown(bondAmount, valuePerUnit(), WadMath.WAD);
    }

    function totalSupply() public view override(ERC20, IBond3643) returns (uint256) {
        return super.totalSupply();
    }

    function balanceOf(address account) public view override(ERC20, IBond3643) returns (uint256) {
        return super.balanceOf(account);
    }

    // --- primary / redemption ----------------------------------------------

    function purchase(uint256 cashIn) external returns (uint256 bondOut) {
        if (isMatured()) revert AlreadyMatured();
        if (cashIn == 0) revert InvalidAmount();
        if (!isVerified(msg.sender)) revert NotVerified(msg.sender);
        uint256 vpu = valuePerUnit();
        bondOut = WadMath.mulDivDown(cashIn, WadMath.WAD, vpu);
        if (bondOut == 0) revert InvalidAmount();
        IERC20(denominationAsset).safeTransferFrom(msg.sender, address(this), cashIn);
        _mint(msg.sender, bondOut);
        emit Purchased(msg.sender, cashIn, bondOut);
    }

    function redeem(uint256 bondAmount) public returns (uint256 cashOut) {
        if (bondAmount == 0) revert InvalidAmount();
        cashOut = valueOf(bondAmount);
        if (cashOut > IERC20(denominationAsset).balanceOf(address(this))) {
            revert InsufficientLiquidity();
        }
        _burn(msg.sender, bondAmount);
        IERC20(denominationAsset).safeTransfer(msg.sender, cashOut);
        emit Redeemed(msg.sender, bondAmount, cashOut);
    }

    function redeemAtMaturity(uint256 bondAmount) external returns (uint256 cashOut) {
        if (!isMatured()) revert NotMatured();
        cashOut = redeem(bondAmount);
        emit RedeemedAtMaturity(msg.sender, bondAmount, cashOut);
    }

    function availableLiquidity() external view returns (uint256) {
        return IERC20(denominationAsset).balanceOf(address(this));
    }

    // --- issuer cashflow ----------------------------------------------------

    /// @notice Adds a cash coupon to the schedule. Issuer only.
    function scheduleCoupon(
        uint256 recordDate,
        uint256 executionDate,
        uint256 ratePerUnit
    ) external onlyOwner returns (uint256 couponId) {
        if (ratePerUnit == 0) revert InvalidAmount();
        if (recordDate >= executionDate || executionDate > maturityTime) revert InvalidSchedule();
        couponId = _coupons.length;
        _coupons.push(
            CouponInfo({
                recordDate: recordDate,
                executionDate: executionDate,
                ratePerUnit: ratePerUnit,
                fundedAmount: 0,
                totalSupplySnapshot: 0,
                exists: true
            })
        );
        emit CouponScheduled(couponId, recordDate, executionDate, ratePerUnit);
    }

    /// @notice Deposits cash against `couponId`. Issuer only.
    function fundCoupon(uint256 couponId, uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        CouponInfo storage coupon = _coupon(couponId);
        IERC20(denominationAsset).safeTransferFrom(msg.sender, address(this), amount);
        coupon.fundedAmount += amount;
        emit CouponFunded(couponId, amount);
    }

    /// @notice Tops up the maturity redemption reserve. Issuer only.
    function fundPrincipal(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        IERC20(denominationAsset).safeTransferFrom(msg.sender, address(this), amount);
        emit PrincipalFunded(amount);
    }

    /// @notice Cash a fully funded coupon should distribute: rate per unit times
    ///         the supply snapshot the first claim will take.
    function couponTargetFunding(uint256 couponId) external view returns (uint256) {
        CouponInfo memory coupon = _coupon(couponId);
        return WadMath.mulDivUp(totalSupply(), coupon.ratePerUnit, WadMath.WAD);
    }

    // --- coupon claims ------------------------------------------------------

    function couponCount() external view returns (uint256) {
        return _coupons.length;
    }

    function couponInfo(uint256 couponId) external view returns (CouponInfo memory) {
        return _coupon(couponId);
    }

    function claimableCoupon(uint256 couponId, address holder) public view returns (uint256) {
        CouponInfo memory coupon = _coupon(couponId);
        if (block.timestamp < coupon.executionDate) return 0;
        if (couponClaimed[couponId][holder]) return 0;
        uint256 snapshot = coupon.totalSupplySnapshot;
        if (snapshot == 0) snapshot = totalSupply();
        if (snapshot == 0) return 0;
        return WadMath.mulDivDown(coupon.fundedAmount, balanceOf(holder), snapshot);
    }

    function claimCoupon(uint256 couponId) external returns (uint256 cashOut) {
        CouponInfo storage coupon = _coupon(couponId);
        if (block.timestamp < coupon.executionDate) revert CouponNotDue();
        if (couponClaimed[couponId][msg.sender]) revert CouponAlreadyClaimed();
        if (coupon.totalSupplySnapshot == 0) {
            uint256 supply = totalSupply();
            if (supply == 0) revert NothingToClaim();
            coupon.totalSupplySnapshot = supply;
        }
        cashOut = WadMath.mulDivDown(coupon.fundedAmount, balanceOf(msg.sender), coupon.totalSupplySnapshot);
        if (cashOut == 0) revert NothingToClaim();
        if (cashOut > IERC20(denominationAsset).balanceOf(address(this))) revert InsufficientLiquidity();
        couponClaimed[couponId][msg.sender] = true;
        IERC20(denominationAsset).safeTransfer(msg.sender, cashOut);
        emit CouponClaimed(couponId, msg.sender, cashOut);
    }

    function accrue() external {}

    // --- internals ----------------------------------------------------------

    function _coupon(uint256 couponId) internal view returns (CouponInfo storage coupon) {
        coupon = _coupons[couponId];
        if (!coupon.exists) revert InvalidSchedule();
    }
}
