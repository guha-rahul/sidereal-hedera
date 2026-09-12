// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ICompliance} from "../../src/interfaces/erc3643/ICompliance.sol";

/// @notice Test-only ERC-3643 compliance module backed by a transfer allowlist.
contract TestCompliance is ICompliance {
    mapping(address => bool) private _allowed;

    function setAllowed(address account, bool allowed) external {
        _allowed[account] = allowed;
    }

    function canTransfer(address from, address to, uint256) external view returns (bool) {
        return _allowed[from] && _allowed[to];
    }
}
