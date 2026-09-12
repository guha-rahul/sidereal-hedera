// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title IIdentityRegistry
/// @notice The ERC-3643 (T-REX) identity registry surface the bond depends on:
///         a wallet is either verified (KYC/allowlisted) or not. Transfers are
///         only valid between verified wallets.
interface IIdentityRegistry {
    /// @notice True when `account` has passed the registry's KYC/allowlist.
    function isVerified(address account) external view returns (bool);
}
