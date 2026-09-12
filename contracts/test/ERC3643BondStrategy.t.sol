// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {MarketFixture} from "./MarketFixture.sol";

/// @notice Proves the issuer's coupon cashflow reaches SY: `touch` claims the
///         strategy's coupon and the exchange rate steps up, and the
///         issuer-funded reserve redeems the position at par after maturity.
contract ERC3643BondStrategyTest is MarketFixture {
    address internal admin = address(0xA11CE);
    address internal alice = address(0xB0B);
    address internal feeRecipient = address(0xFEE);

    function setUp() public {
        _setUpMarket(admin, feeRecipient, 1_000_000e18);

        cash.mint(alice, 1_000_000e18);
        vm.startPrank(alice);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(tokenizer), type(uint256).max);
        vm.stopPrank();

        cash.mint(issuer, 1_000_000e18);
        vm.startPrank(issuer);
        cash.approve(address(bond), type(uint256).max);
        vm.stopPrank();
    }

    function testTouchClaimsCouponAndRaisesExchangeRate() public {
        vm.prank(alice);
        sy.deposit(1_000e18, 0);

        uint256 rateBefore = sy.exchangeRate();

        vm.startPrank(issuer);
        uint256 couponId = bond.scheduleCoupon(t0 + 25 days, t0 + 30 days, 0.02e18);
        bond.fundCoupon(couponId, bond.couponTargetFunding(couponId));
        vm.stopPrank();

        vm.warp(t0 + 30 days);
        strategy.touch();

        assertGt(strategy.countedCash(), 0, "coupon claimed into the strategy as cash");
        assertGt(sy.exchangeRate(), rateBefore, "claiming a coupon raises the SY rate");
        assertApproxEqAbs(strategy.countedCash(), 21e18, 1e18, "2% coupon on ~1053 bonds");
    }

    function testIssuerReserveRedeemsAtParAfterMaturity() public {
        vm.prank(alice);
        sy.deposit(1_000e18, 0);

        vm.warp(maturity);
        uint256 rate = sy.exchangeRate();
        uint256 syBal = sy.balanceOf(alice);
        vm.prank(alice);
        uint256 cashOut = sy.redeem(syBal, 0);

        // Accounted bonds ~1053 (1000 / 0.95) redeem at par (1.0).
        assertApproxEqRel(cashOut, (syBal * rate) / 1e18, 1e15);
        assertGt(cashOut, 1_000e18, "accretion realized through the issuer reserve");
    }

    function testWithdrawPreMaturityUsesIssuerBuyback() public {
        vm.prank(alice);
        sy.deposit(1_000e18, 0);

        vm.warp(t0 + 30 days);
        uint256 rate = sy.exchangeRate();
        uint256 syBal = sy.balanceOf(alice);
        vm.prank(alice);
        uint256 cashOut = sy.redeem(syBal, 0);

        // Early redemption pays the accreted value, funded by the issuer reserve.
        assertApproxEqRel(cashOut, (syBal * rate) / 1e18, 1e15);
        assertGt(cashOut, 1_000e18 - 1e16, "accrued value returned pre-maturity");
    }
}
