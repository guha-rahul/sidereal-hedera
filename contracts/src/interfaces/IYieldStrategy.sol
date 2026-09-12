// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title IYieldStrategy
/// @notice The strategy seam: the one ABI every Sidereal yield source implements.
/// @dev Two properties are
///      obligations of the seam itself, so every adapter inherits them:
///
///      1. `deposit` and `withdraw` return measured deltas, never requested
///         amounts. An upstream that floors in its own favour can then never
///         mint SY the position does not back.
///      2. `totalAssets` values only assets the strategy itself put to work.
///         Underlying that merely sits at the strategy's address (anyone can
///         send it there) must not enter the valuation, or the exchange rate
///         becomes a function of a permissionless token transfer.
interface IYieldStrategy {
    function isEligible(address account) external view returns (bool);
    function maturity() external view returns (uint256);
    function settlementReady() external view returns (bool);
    /// @notice The underlying asset this strategy consumes and returns.
    function underlying() external view returns (address);

    /// @notice The SY vault allowed to call `deposit` and `withdraw`. Fixed at init.
    function vault() external view returns (address);

    /// @notice Underlying the strategy's whole position is currently worth.
    ///         Excludes idle, unaccounted balances.
    function totalAssets() external view returns (uint256);

    /// @notice Underlying that could be withdrawn right now. Always <= totalAssets.
    function maxWithdraw() external view returns (uint256);

    /// @notice Moves `amount` of underlying from `vault` into the yield source.
    /// @return credited The measured increase in `totalAssets`.
    function deposit(address vault, uint256 amount) external returns (uint256 credited);

    /// @notice Withdraws underlying worth `amount` back to `vault`.
    /// @param minUnderlyingOut Revert if the amount delivered is below this.
    /// @return delivered The underlying actually delivered.
    function withdraw(address vault, uint256 amount, uint256 minUnderlyingOut)
        external
        returns (uint256 delivered);

    /// @notice Permissionless upkeep. Renews any upstream position bookkeeping.
    function touch() external;
}
