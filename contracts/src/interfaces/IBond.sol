// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title IBond
/// @notice Minimal surface of an ERC-3643 / ATS tokenized bond used by the
///         Sidereal bond strategy. The bond's denomination (e.g. a stablecoin)
///         is the strategy's underlying; the bond itself is the yield source.
/// @dev Coupons in this reference model are **capitalized** into `valuePerUnit`
///      (a `distributeCoupon` call raises every holder's per-unit value) rather
///      than paid out as cash. A production ATS bond that pays cash instead can
///      be adapted by sweeping the coupon into the strategy and reinvesting;
///      the strategy seam is unchanged.
interface IBond {
    function denomination() external view returns (address);

    function maturity() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    /// @notice Cash value of one bond unit right now, WAD-scaled.
    function valuePerUnit() external view returns (uint256);

    /// @notice Cash value of `bondAmount` bond units right now.
    function valueOf(uint256 bondAmount) external view returns (uint256);

    /// @notice Buys `cashIn` denomination and returns bond units minted. Pulls
    ///         the cash from the caller.
    function purchase(uint256 cashIn) external returns (uint256 bondOut);

    /// @notice Burns `bondAmount` and pays its current cash value to the caller.
    function redeem(uint256 bondAmount) external returns (uint256 cashOut);

    /// @notice Cash the bond can presently pay out.
    function availableLiquidity() external view returns (uint256);

    /// @notice Capitalizes `cashAmount` of coupon across all bond holders. Pulls
    ///         the cash from the caller.
    function distributeCoupon(uint256 cashAmount) external;

    /// @notice Permissionless accrual poke.
    function accrue() external;
}
