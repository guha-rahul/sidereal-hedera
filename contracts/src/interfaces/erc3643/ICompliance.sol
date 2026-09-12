// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title ICompliance
/// @notice The ERC-3643 (T-REX) compliance surface the bond depends on. The
///         registry answers *who* may hold the security; compliance answers
///         whether a *specific transfer* is allowed (investor limits, lock-ups,
///         country restrictions, ...).
interface ICompliance {
    /// @notice True when moving `amount` from `from` to `to` satisfies the rule set.
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);
}
