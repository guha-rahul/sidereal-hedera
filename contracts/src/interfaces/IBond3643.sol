// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title IBond3643
/// @notice Production-shaped surface of an ERC-3643 / ATS tokenized bond: a
///         permissioned security whose yield is the issuer's **cash coupon and
///         maturity cashflow**, not a capitalized per-unit rate.
/// @dev Coupons are scheduled by the issuer, funded in cash, and claimed by
///      holders on/after the execution date. Principal accretes linearly from
///      the issue price to `nominalValue` and is redeemed at maturity. The SY
///      strategy reads `valueOf`/`availableLiquidity` for valuation and calls
///      `claimCoupon`/`redeemAtMaturity` to realize the cashflow.
interface IBond3643 {
    struct CouponInfo {
        uint256 recordDate;
        uint256 executionDate;
        /// @dev Cash coupon per bond unit, WAD-scaled (0.02e18 = 2%).
        uint256 ratePerUnit;
        /// @dev Cash the issuer has deposited for this coupon.
        uint256 fundedAmount;
        /// @dev Supply snapshot taken on the first claim; 0 until then.
        uint256 totalSupplySnapshot;
        bool exists;
    }

    // --- terms --------------------------------------------------------------

    /// @notice ERC-20 the bond is denominated in (the strategy's underlying).
    function denomination() external view returns (address);

    /// @notice Unix time the accretion clock starts.
    function startDate() external view returns (uint256);

    /// @notice Unix time principal becomes redeemable at par.
    function maturityDate() external view returns (uint256);

    /// @notice Cash value of one bond unit at maturity, WAD-scaled.
    function nominalValue() external view returns (uint256);

    /// @notice Accreted cash value of one bond unit right now, WAD-scaled.
    function valuePerUnit() external view returns (uint256);

    /// @notice Accreted cash value of `bondAmount` bond units right now.
    function valueOf(uint256 bondAmount) external view returns (uint256);

    function isMatured() external view returns (bool);

    // --- token --------------------------------------------------------------

    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    // --- primary / redemption ----------------------------------------------

    /// @notice Issues `bondOut` bonds to the caller for `cashIn` denomination.
    function purchase(uint256 cashIn) external returns (uint256 bondOut);

    /// @notice Redeems `bondAmount` at the current accreted value (par at
    ///         maturity) and pays the caller. Funded by purchases and the
    ///         issuer's principal reserve; backs both early buyback and maturity
    ///         redemption.
    function redeem(uint256 bondAmount) external returns (uint256 cashOut);

    /// @notice Burns `bondAmount` after maturity and pays the caller `nominalValue`.
    function redeemAtMaturity(uint256 bondAmount) external returns (uint256 cashOut);

    /// @notice Cash the bond can presently pay out (purchase + issuer funding).
    function availableLiquidity() external view returns (uint256);

    // --- coupons / issuer cashflow -----------------------------------------

    function couponCount() external view returns (uint256);

    function couponInfo(uint256 couponId) external view returns (CouponInfo memory);

    /// @notice Cash `holder` would receive by claiming `couponId` now.
    function claimableCoupon(uint256 couponId, address holder) external view returns (uint256);

    /// @notice Claims the caller's share of a funded, executed coupon.
    function claimCoupon(uint256 couponId) external returns (uint256 cashOut);

    /// @notice Permissionless accrual poke.
    function accrue() external;
}
