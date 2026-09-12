// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC3643Base} from "../tokens/ERC3643Base.sol";
import {IBond3643} from "../interfaces/IBond3643.sol";
import {WadMath} from "../libraries/WadMath.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ERC3643Bond
/// @notice Production-shaped tokenized bond: a permissioned ERC-3643 security
///         whose yield is paid as **cash** coupons by the issuer and whose
///         principal accretes to par for redemption at maturity.
/// @dev `valuePerUnit` reflects principal accretion only; coupons are separate,
///      issuer-funded cashflows that holders claim on/after each execution date. The issuer schedules
///      and funds coupons (`scheduleCoupon` / `fundCoupon`) and tops up the
///      redemption reserve (`fundPrincipal`); purchases also fund the reserve.
///
///      Local reference bond, not ATS. Coupon entitlements use timestamped
///      record-date balance and supply checkpoints. Funding closes at the
///      record date; coupon reserves cannot be spent by principal redemption.
contract ERC3643Bond is ERC3643Base, IBond3643, ReentrancyGuard {
    using Checkpoints for Checkpoints.Trace208;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    address public immutable denominationAsset;
    uint256 public immutable startTime;
    uint256 public immutable maturityTime;
    uint256 public immutable issuePricePerUnit;
    uint256 public immutable nominalValuePerUnit;

    CouponInfo[] private _coupons;
    mapping(uint256 => mapping(address => bool)) public couponClaimed;
    mapping(address => Checkpoints.Trace208) private _balances;
    Checkpoints.Trace208 private _supply;
    mapping(uint256 => uint256) public couponPaid;
    uint256 public reservedCoupons;
    uint256 public constant MAX_COUPONS = 32;

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
    event CouponScheduled(
        uint256 indexed couponId, uint256 recordDate, uint256 executionDate, uint256 ratePerUnit
    );
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

    function securityToken() external view returns (address) {
        return address(this);
    }

    function isVerified(address account)
        public
        view
        override(ERC3643Base, IBond3643)
        returns (bool)
    {
        return super.isVerified(account);
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

    function purchase(uint256 cashIn) external nonReentrant returns (uint256 bondOut) {
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

    function redeem(uint256 bondAmount) public nonReentrant returns (uint256 cashOut) {
        if (bondAmount == 0) revert InvalidAmount();
        cashOut = valueOf(bondAmount);
        if (cashOut > availableLiquidity()) {
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

    function availableLiquidity() public view returns (uint256) {
        uint256 cash = IERC20(denominationAsset).balanceOf(address(this));
        return cash > reservedCoupons ? cash - reservedCoupons : 0;
    }

    // --- issuer cashflow ----------------------------------------------------

    /// @notice Adds a cash coupon to the schedule. Issuer only.
    function scheduleCoupon(uint256 recordDate, uint256 executionDate, uint256 ratePerUnit)
        external
        onlyOwner
        returns (uint256 couponId)
    {
        if (ratePerUnit == 0) revert InvalidAmount();
        if (
            recordDate <= block.timestamp || recordDate >= executionDate
                || executionDate > maturityTime || _coupons.length >= MAX_COUPONS
        ) revert InvalidSchedule();
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
    function fundCoupon(uint256 couponId, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        CouponInfo storage coupon = _coupon(couponId);
        if (block.timestamp >= coupon.recordDate) revert InvalidSchedule();
        uint256 beforeCash = IERC20(denominationAsset).balanceOf(address(this));
        IERC20(denominationAsset).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(denominationAsset).balanceOf(address(this)) - beforeCash != amount) {
            revert InvalidAmount();
        }
        coupon.fundedAmount += amount;
        reservedCoupons += amount;
        emit CouponFunded(couponId, amount);
    }

    /// @notice Tops up the maturity redemption reserve. Issuer only.
    function fundPrincipal(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        IERC20(denominationAsset).safeTransferFrom(msg.sender, address(this), amount);
        emit PrincipalFunded(amount);
    }

    /// @notice Funding estimate using current supply; funding closes at record date.
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

    function accruedCoupon(uint256 couponId, address holder) public view returns (uint256) {
        CouponInfo memory coupon = _coupon(couponId);
        if (block.timestamp <= coupon.recordDate) return 0;
        if (couponClaimed[couponId][holder]) return 0;
        uint256 snapshot = _supply.upperLookup(coupon.recordDate.toUint48());
        if (snapshot == 0) return 0;
        return WadMath.mulDivDown(coupon.fundedAmount, couponBalance(couponId, holder), snapshot);
    }

    function couponBalance(uint256 couponId, address holder) public view returns (uint256) {
        CouponInfo memory coupon = _coupon(couponId);
        if (block.timestamp <= coupon.recordDate) return 0;
        return _balances[holder].upperLookup(coupon.recordDate.toUint48());
    }

    function claimableCoupon(uint256 couponId, address holder) public view returns (uint256) {
        if (block.timestamp < _coupon(couponId).executionDate) return 0;
        return accruedCoupon(couponId, holder);
    }

    function claimCoupon(uint256 couponId) external nonReentrant returns (uint256 cashOut) {
        CouponInfo storage coupon = _coupon(couponId);
        if (block.timestamp < coupon.executionDate) revert CouponNotDue();
        if (couponClaimed[couponId][msg.sender]) revert CouponAlreadyClaimed();
        if (coupon.totalSupplySnapshot == 0) {
            uint256 supply = _supply.upperLookup(coupon.recordDate.toUint48());
            if (supply == 0) revert NothingToClaim();
            coupon.totalSupplySnapshot = supply;
        }
        if (!isVerified(msg.sender)) revert NotVerified(msg.sender);
        cashOut = accruedCoupon(couponId, msg.sender);
        if (cashOut == 0) revert NothingToClaim();
        if (cashOut > IERC20(denominationAsset).balanceOf(address(this))) {
            revert InsufficientLiquidity();
        }
        couponClaimed[couponId][msg.sender] = true;
        couponPaid[couponId] += cashOut;
        reservedCoupons -= cashOut;
        IERC20(denominationAsset).safeTransfer(msg.sender, cashOut);
        emit CouponClaimed(couponId, msg.sender, cashOut);
    }

    function accrue() external {}

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        uint48 now_ = block.timestamp.toUint48();
        if (from != address(0)) _balances[from].push(now_, balanceOf(from).toUint208());
        if (to != address(0)) _balances[to].push(now_, balanceOf(to).toUint208());
        if (from == address(0) || to == address(0)) _supply.push(now_, totalSupply().toUint208());
    }

    // --- internals ----------------------------------------------------------

    function _coupon(uint256 couponId) internal view returns (CouponInfo storage coupon) {
        coupon = _coupons[couponId];
        if (!coupon.exists) revert InvalidSchedule();
    }
}
