// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {TestIdentityRegistry} from "./mocks/TestIdentityRegistry.sol";
import {TestCompliance} from "./mocks/TestCompliance.sol";
import {ERC3643Bond} from "../src/sy/ERC3643Bond.sol";
import {ERC3643BondStrategy} from "../src/sy/ERC3643BondStrategy.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {Tokenizer} from "../src/Tokenizer.sol";

/// @notice Shared setup for the protocol suites: a real `ERC3643Bond` market
///         (permissioned bond, cash-coupon issuer cashflow) behind the
///         `ERC3643BondStrategy`. The only test-only pieces are the ERC-20,
///         identity registry, and compliance doubles under `test/mocks/`.
abstract contract MarketFixture is Test {
    uint256 internal constant WAD = 1e18;

    TestERC20 internal cash;
    TestIdentityRegistry internal registry;
    TestCompliance internal compliance;
    ERC3643Bond internal bond;
    StandardizedYieldVault internal sy;
    ERC3643BondStrategy internal strategy;
    PrincipalToken internal pt;
    YieldToken internal yt;
    Tokenizer internal tokenizer;

    address internal issuer;
    uint256 internal t0;
    uint256 internal maturity;

    /// @dev Deploys the market. `issuer_` owns the bond and funds its cashflows;
    ///      `bondFunding` seeds the principal reserve that backs early buyback
    ///      and maturity redemption.
    function _setUpMarket(address issuer_, address feeRecipient, uint256 bondFunding) internal {
        t0 = 1_770_000_000;
        vm.warp(t0);
        maturity = t0 + 90 days;
        issuer = issuer_;

        cash = new TestERC20("USD", "USD", 18);
        registry = new TestIdentityRegistry();
        compliance = new TestCompliance();

        bond = new ERC3643Bond(address(cash), issuer_, t0, maturity, 0.95e18, 1e18);
        vm.startPrank(issuer_);
        bond.setIdentityRegistry(address(registry));
        bond.setCompliance(address(compliance));
        vm.stopPrank();

        cash.mint(address(bond), bondFunding);

        sy = new StandardizedYieldVault();
        strategy = new ERC3643BondStrategy(address(sy), address(bond));
        sy.initialize(issuer_, address(strategy));

        // The strategy must be a verified holder to receive ERC-3643 bonds.
        registry.setVerified(address(strategy), true);
        compliance.setAllowed(address(strategy), true);

        pt = new PrincipalToken();
        yt = new YieldToken();
        tokenizer = new Tokenizer();
        tokenizer.initialize(
            issuer_, address(sy), address(pt), address(yt), maturity, feeRecipient, 0
        );
        pt.initialize(issuer_, address(tokenizer), address(sy), maturity);
        yt.initialize(issuer_, address(tokenizer), address(sy), maturity);
        _verify(issuer_);
        _verify(feeRecipient);
        _verify(address(tokenizer));
        _verify(address(sy));
        _verify(address(0xA11CE1));
        _verify(address(0xB0B));
    }

    function _verify(address account) internal {
        registry.setVerified(account, true);
        compliance.setAllowed(account, true);
    }
}
