// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IIdentityRegistry} from "../../src/interfaces/erc3643/IIdentityRegistry.sol";

/// @notice Test-only ERC-3643 identity registry backed by a simple allowlist.
contract TestIdentityRegistry is IIdentityRegistry {
    mapping(address => bool) private _verified;

    function setVerified(address account, bool verified) external {
        _verified[account] = verified;
    }

    function isVerified(address account) external view returns (bool) {
        return _verified[account];
    }
}
