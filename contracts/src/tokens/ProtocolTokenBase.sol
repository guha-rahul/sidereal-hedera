// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IMarketAccess} from "../interfaces/IMarketAccess.sol";

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
    address private immutable _initializer = msg.sender;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidMaturity();
    error NotTokenizer();
    error InvalidAmount();
    error InvalidConfiguration();
    error NotEligible(address account);

    event Initialized(address admin, address tokenizer, address syToken, uint256 maturity);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function _baseInitialize(address admin, address tokenizer, address syToken, uint256 maturity_)
        internal
    {
        if (_initialized) revert AlreadyInitialized();
        if (
            msg.sender != _initializer || admin == address(0) || tokenizer == address(0)
                || syToken == address(0)
        ) revert InvalidConfiguration();
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

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !IMarketAccess(config.syToken).isEligible(from)) {
            revert NotEligible(from);
        }
        if (to != address(0) && !IMarketAccess(config.syToken).isEligible(to)) {
            revert NotEligible(to);
        }
        super._update(from, to, value);
    }
}
