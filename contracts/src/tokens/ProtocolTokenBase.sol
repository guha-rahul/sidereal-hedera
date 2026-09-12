// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ProtocolTokenBase
/// @notice Shared configuration and access control for the PT and YT tokens.
/// @dev Both tokens carry the same immutable-after-init config. The tokenizer
///      recorded here is the only address allowed to mint or forcibly burn.
abstract contract ProtocolTokenBase is ERC20 {
    struct Config {
        address admin;
        address tokenizer;
        address syToken;
        uint256 maturity;
    }

    Config public config;
    bool internal _initialized;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidMaturity();
    error NotTokenizer();
    error InvalidAmount();

    event Initialized(address admin, address tokenizer, address syToken, uint256 maturity);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function _baseInitialize(
        address admin,
        address tokenizer,
        address syToken,
        uint256 maturity_
    ) internal {
        if (_initialized) revert AlreadyInitialized();
        if (maturity_ <= block.timestamp) revert InvalidMaturity();
        _initialized = true;
        config = Config({admin: admin, tokenizer: tokenizer, syToken: syToken, maturity: maturity_});
        emit Initialized(admin, tokenizer, syToken, maturity_);
    }

    modifier onlyTokenizer() {
        if (msg.sender != config.tokenizer) revert NotTokenizer();
        _;
    }

    function maturity() public view returns (uint256) {
        return config.maturity;
    }

    function isMatured() public view returns (bool) {
        return block.timestamp >= config.maturity;
    }
}
