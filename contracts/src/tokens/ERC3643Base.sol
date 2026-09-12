// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIdentityRegistry} from "../interfaces/erc3643/IIdentityRegistry.sol";
import {ICompliance} from "../interfaces/erc3643/ICompliance.sol";

/// @title ERC3643Base
/// @notice ERC-3643 (T-REX) style permissioned ERC-20: every non-mint, non-burn
///         transfer requires both counterparties to be verified by an identity
///         registry and cleared by a compliance module.
/// @dev Mirrors the T-REX invariants that matter to the strategy: a wallet can
///      only receive the security if the registry has verified it. Mint (from
///      zero) and burn (to zero) bypass the counterparty checks, so issuers and
///      redeemers must verify the account explicitly where it matters.
abstract contract ERC3643Base is ERC20, Ownable {
    IIdentityRegistry public identityRegistry;
    ICompliance public compliance;

    event IdentityRegistrySet(address indexed registry);
    event ComplianceSet(address indexed compliance);

    error NotVerified(address account);
    error TransferNotCompliant(address from, address to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {}

    /// @notice Points the token at its identity registry. Owner only.
    function setIdentityRegistry(address registry) external onlyOwner {
        identityRegistry = IIdentityRegistry(registry);
        emit IdentityRegistrySet(registry);
    }

    /// @notice Points the token at its compliance module. Owner only.
    function setCompliance(address compliance_) external onlyOwner {
        compliance = ICompliance(compliance_);
        emit ComplianceSet(compliance_);
    }

    /// @notice True when `account` may hold the security. Open when no registry
    ///         is configured, so the token is usable in unit tests standalone.
    function isVerified(address account) public view returns (bool) {
        IIdentityRegistry registry = identityRegistry;
        return address(registry) == address(0) || registry.isVerified(account);
    }

    /// @dev Counterparty permissioning for peer transfers. `from == address(0)`
    ///      is a mint and `to == address(0)` is a burn; neither is gated here.
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from != address(0) && to != address(0)) {
            if (!isVerified(from)) revert NotVerified(from);
            if (!isVerified(to)) revert NotVerified(to);
            ICompliance rules = compliance;
            if (address(rules) != address(0) && !rules.canTransfer(from, to, value)) {
                revert TransferNotCompliant(from, to, value);
            }
        }
        super._update(from, to, value);
    }
}
