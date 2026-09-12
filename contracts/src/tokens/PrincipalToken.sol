// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ProtocolTokenBase} from "./ProtocolTokenBase.sol";

/// @title PrincipalToken (sPT)
/// @notice Fixed-principal claim minted by the tokenizer on split and burned on
///         recombine/redemption. PT is principal only: it does not capture yield.
/// @dev Redemption is priced by the
///      tokenizer, never here — this contract has neither the frozen maturity
///      rate nor escrow, so any quote it computed would be wrong.
contract PrincipalToken is ProtocolTokenBase {
    constructor() ProtocolTokenBase("Sidereal Principal Token", "sPT") {}

    function initialize(
        address admin,
        address tokenizer,
        address syToken,
        uint256 maturity_
    ) external {
        _baseInitialize(admin, tokenizer, syToken, maturity_);
    }

    /// @notice Mints `amount` PT to `to`. Restricted to the tokenizer.
    function mint(address to, uint256 amount) external onlyTokenizer {
        if (amount == 0) revert InvalidAmount();
        _mint(to, amount);
    }

    /// @notice Burns `amount` PT from `from` without allowance. Restricted to
    ///         the tokenizer, which burns on recombine and redemption.
    function burnFrom(address from, uint256 amount) external onlyTokenizer {
        if (amount == 0) revert InvalidAmount();
        _burn(from, amount);
    }

    /// @notice Burns the caller's own PT.
    function burn(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        _burn(msg.sender, amount);
    }
}
