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
/// @dev Local reference token, not an ATS deployment. Mint, burn and transfer
///      require verified nonzero holders. An absent registry fails closed.
abstract contract ERC3643Base is ERC20, Ownable {
    IIdentityRegistry public identityRegistry;
    ICompliance public compliance;

    event IdentityRegistrySet(address indexed registry);
    event ComplianceSet(address indexed compliance);

    error NotVerified(address account);
    error TransferNotCompliant(address from, address to, uint256 amount);

    constructor(string memory name_, string memory symbol_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {}

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

    /// @notice True when the configured registry verifies the holder.
    function isVerified(address account) public view virtual returns (bool) {
        IIdentityRegistry registry = identityRegistry;
        return address(registry) != address(0) && registry.isVerified(account);
    }

    /// @dev Nonzero holders remain gated during mint and burn, including exit.
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from != address(0) && !isVerified(from)) revert NotVerified(from);
        if (to != address(0) && !isVerified(to)) revert NotVerified(to);
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
