// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBond} from "../interfaces/IBond.sol";
import {WadMath} from "../libraries/WadMath.sol";

/// @title MockTokenizedBond
/// @notice Reference implementation of an ERC-3643/ATS-style tokenized bond,
///         used to exercise the SY bond strategy without a live ATS deployment.
/// @dev The bond accretes linearly from `issuePricePerUnit` to `faceValuePerUnit`
///      over `[startTime, maturity]` (the maturity cashflow) and can additionally
///      capitalize coupons via `distributeCoupon` (the coupon cashflow). Cash
///      from purchases and coupons funds redemptions, so the contract is solvent
///      by construction as long as the issuer funds the accreted yield.
contract MockTokenizedBond is ERC20, IBond {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    address public immutable denominationAsset;
    uint256 public immutable maturityTime;
    uint256 public immutable startTime;
    uint256 public immutable issuePricePerUnit;
    uint256 public immutable faceValuePerUnit;

    uint256 public couponValuePerUnit;

    error InvalidAmount();
    error NotMatured();
    error InvalidPrice();
    error NotIssuer();
    error InsufficientLiquidity();
    error CouponWithNoHolders();

    event Purchased(address indexed buyer, uint256 cashIn, uint256 bondOut);
    event Redeemed(address indexed holder, uint256 bondIn, uint256 cashOut);
    event CouponDistributed(uint256 cashAmount, uint256 couponValuePerUnit);

    constructor(
        address denomination_,
        uint256 startTime_,
        uint256 maturity_,
        uint256 issuePricePerUnit_,
        uint256 faceValuePerUnit_
    ) ERC20("Tokenized Treasury Bond", "T-BOND") {
        if (maturity_ <= startTime_) revert NotMatured();
        if (issuePricePerUnit_ == 0 || faceValuePerUnit_ < issuePricePerUnit_) {
            revert InvalidPrice();
        }
        denominationAsset = denomination_;
        startTime = startTime_;
        maturityTime = maturity_;
        issuePricePerUnit = issuePricePerUnit_;
        faceValuePerUnit = faceValuePerUnit_;
    }

    // --- IBond --------------------------------------------------------------

    function totalSupply() public view override(ERC20, IBond) returns (uint256) {
        return super.totalSupply();
    }

    function balanceOf(address account) public view override(ERC20, IBond) returns (uint256) {
        return super.balanceOf(account);
    }

    function denomination() external view returns (address) {
        return denominationAsset;
    }

    function maturity() external view returns (uint256) {
        return maturityTime;
    }

    function valuePerUnit() public view returns (uint256) {
        return principalValuePerUnit(block.timestamp) + couponValuePerUnit;
    }

    function valueOf(uint256 bondAmount) public view returns (uint256) {
        return WadMath.mulDivDown(bondAmount, valuePerUnit(), WadMath.WAD);
    }

    function purchase(uint256 cashIn) external returns (uint256 bondOut) {
        if (cashIn == 0) revert InvalidAmount();
        uint256 vpu = valuePerUnit();
        bondOut = WadMath.mulDivDown(cashIn, WadMath.WAD, vpu);
        if (bondOut == 0) revert InvalidAmount();
        IERC20(denominationAsset).safeTransferFrom(msg.sender, address(this), cashIn);
        _mint(msg.sender, bondOut);
        emit Purchased(msg.sender, cashIn, bondOut);
    }

    function redeem(uint256 bondAmount) external returns (uint256 cashOut) {
        if (bondAmount == 0) revert InvalidAmount();
        cashOut = valueOf(bondAmount);
        if (cashOut > IERC20(denominationAsset).balanceOf(address(this))) {
            revert InsufficientLiquidity();
        }
        _burn(msg.sender, bondAmount);
        IERC20(denominationAsset).safeTransfer(msg.sender, cashOut);
        emit Redeemed(msg.sender, bondAmount, cashOut);
    }

    function availableLiquidity() external view returns (uint256) {
        return IERC20(denominationAsset).balanceOf(address(this));
    }

    function distributeCoupon(uint256 cashAmount) external {
        if (cashAmount == 0) revert InvalidAmount();
        if (totalSupply() == 0) revert CouponWithNoHolders();
        IERC20(denominationAsset).safeTransferFrom(msg.sender, address(this), cashAmount);
        uint256 added = WadMath.mulDivDown(cashAmount, WadMath.WAD, totalSupply());
        couponValuePerUnit += added;
        emit CouponDistributed(cashAmount, couponValuePerUnit);
    }

    function accrue() external {}

    // --- views --------------------------------------------------------------

    /// @notice Linear accreted principal per unit at `timestamp`.
    function principalValuePerUnit(uint256 timestamp) public view returns (uint256) {
        if (timestamp <= startTime) return issuePricePerUnit;
        if (timestamp >= maturityTime) return faceValuePerUnit;
        uint256 elapsed = timestamp - startTime;
        uint256 term = maturityTime - startTime;
        uint256 step = WadMath.mulDivDown(faceValuePerUnit - issuePricePerUnit, elapsed, term);
        return issuePricePerUnit + step;
    }
}
