// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice A revoked holder cannot mint, transfer, burn or redeem market claims.
interface IMarketAccess {
    function isEligible(address account) external view returns (bool);
}
