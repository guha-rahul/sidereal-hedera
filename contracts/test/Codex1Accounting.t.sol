// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {ERC3643BondTest} from "./ERC3643Bond.t.sol";
import {ERC3643BondStrategyTest} from "./ERC3643BondStrategy.t.sol";

contract Codex1CouponRegression is ERC3643BondTest {
    function testTransferCannotRepeatCouponClaim() public {
        uint256 bonds = _purchase(alice, 950e18);
        vm.startPrank(issuer);
        uint256 id = bond.scheduleCoupon(t0 + 1 days, t0 + 2 days, 0.1e18);
        cash.approve(address(bond), type(uint256).max);
        bond.fundCoupon(id, 100e18);
        vm.stopPrank();
        vm.warp(t0 + 2 days);
        vm.prank(alice);
        assertEq(bond.claimCoupon(id), 100e18);
        vm.prank(alice);
        bond.transfer(bob, bonds);
        assertEq(bond.claimableCoupon(id, bob), 0);
        vm.prank(bob);
        vm.expectRevert();
        bond.claimCoupon(id);
        assertEq(cash.balanceOf(address(bond)), 950e18);
    }

    function testTransferBeforeClaimPreservesRecordHolder() public {
        uint256 bonds = _purchase(alice, 950e18);
        vm.startPrank(issuer);
        uint256 id = bond.scheduleCoupon(t0 + 1 days, t0 + 2 days, 0.1e18);
        cash.approve(address(bond), type(uint256).max);
        bond.fundCoupon(id, 100e18);
        vm.stopPrank();
        vm.warp(t0 + 1 days + 1);
        vm.prank(alice);
        bond.transfer(bob, bonds);
        vm.warp(t0 + 2 days);
        assertEq(bond.claimableCoupon(id, alice), 100e18);
        assertEq(bond.claimableCoupon(id, bob), 0);
        assertEq(bond.availableLiquidity(), 950e18);
    }
}

contract Codex1StrategyRegression is ERC3643BondStrategyTest {
    function testNonAdminCannotChangeCap() public {
        vm.prank(alice);
        vm.expectRevert();
        sy.setDepositCap(admin, 1);
        vm.prank(admin);
        sy.setDepositCap(admin, 10_000e18);
        assertEq(sy.depositCap(), 10_000e18);
    }

    function testRevocationBlocksEveryClaimTokenAndExit() public {
        vm.startPrank(alice);
        uint256 shares = sy.deposit(950e18, 0);
        tokenizer.split(shares / 2);
        vm.stopPrank();
        registry.setVerified(alice, false);
        vm.startPrank(alice);
        vm.expectRevert();
        sy.transfer(admin, 1);
        vm.expectRevert();
        pt.transfer(admin, 1);
        vm.expectRevert();
        yt.transfer(admin, 1);
        vm.expectRevert();
        sy.redeem(1e18, 0);
        vm.expectRevert();
        tokenizer.recombine(1e18, 1e18);
        vm.stopPrank();
        registry.setVerified(alice, true);
        vm.prank(alice);
        assertGt(sy.redeem(1e18, 0), 0);
    }

    function testUnverifiedCannotDepositOrReceivePT() public {
        address newcomer = address(0xCAFE);
        cash.mint(newcomer, 950e18);
        vm.startPrank(newcomer);
        cash.approve(address(sy), type(uint256).max);
        vm.expectRevert();
        sy.deposit(950e18, 0);
        vm.stopPrank();
        vm.startPrank(alice);
        uint256 shares = sy.deposit(950e18, 0);
        tokenizer.split(shares);
        vm.expectRevert();
        pt.transfer(newcomer, 1e18);
        vm.stopPrank();
    }

    function testNewDepositorDoesNotCaptureDueCoupon() public {
        vm.prank(alice);
        sy.deposit(950e18, 0);
        vm.startPrank(issuer);
        uint256 id = bond.scheduleCoupon(t0 + 1 days, t0 + 2 days, 0.1e18);
        bond.fundCoupon(id, 100e18);
        vm.stopPrank();
        vm.warp(t0 + 2 days);
        address newcomer = address(0xCAFE);
        _verify(newcomer);
        cash.mint(newcomer, 950e18);
        vm.startPrank(newcomer);
        cash.approve(address(sy), type(uint256).max);
        uint256 shares = sy.deposit(950e18, 0);
        strategy.touch();
        uint256 paid = sy.redeem(shares, 0);
        vm.stopPrank();
        assertLe(paid, 950e18);
        assertApproxEqAbs(paid, 950e18, 10);
    }

    function testMaturityCouponIncludedWithoutKeeperObservation() public {
        vm.startPrank(alice);
        uint256 shares = sy.deposit(950e18, 0);
        tokenizer.split(shares);
        vm.stopPrank();
        vm.startPrank(issuer);
        uint256 id = bond.scheduleCoupon(maturity - 1 days, maturity, 0.1e18);
        bond.fundCoupon(id, 100e18);
        vm.stopPrank();
        vm.warp(maturity);
        uint256 face = pt.balanceOf(alice);
        vm.prank(alice);
        uint256 principalShares = tokenizer.redeemAtMaturity(face);
        vm.prank(alice);
        uint256 cashOut = sy.redeem(principalShares, 0);
        assertApproxEqAbs(cashOut, face, 100);
        vm.prank(alice);
        uint256 yieldShares = tokenizer.claimYield();
        assertGt(yieldShares, 0);
        assertEq(strategy.countedCash(), 0); // principal withdrawal consumes coupon cash first
        assertGt(tokenizer.maturityRate(), 1.15e18);
    }
}
