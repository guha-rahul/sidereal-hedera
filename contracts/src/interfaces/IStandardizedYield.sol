// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title IStandardizedYield
/// @notice The interface above the strategy seam: SY is an ERC-20 share whose
///         value is derived, never set.
interface IStandardizedYield {
    /// @notice Deposits `amount` underlying from the caller and returns SY minted.
    function deposit(uint256 amount) external returns (uint256 syOut);

    /// @notice Redeems `syAmount` SY from the caller and returns underlying out.
    function redeem(uint256 syAmount) external returns (uint256 underlyingOut);

    /// @notice SY per underlying, scaled to 18 decimals. Derived from strategy
    ///         holdings over SY supply; there is no setter.
    function exchangeRate() external view returns (uint256);

    /// @notice The underlying asset.
    function underlying() external view returns (address);

    /// @notice Underlying value of `holder`'s position above their principal.
    function accruedYield(address holder) external view returns (uint256);
}
