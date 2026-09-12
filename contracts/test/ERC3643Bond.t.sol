// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {TestIdentityRegistry} from "./mocks/TestIdentityRegistry.sol";
import {TestCompliance} from "./mocks/TestCompliance.sol";
import {ERC3643Bond} from "../src/sy/ERC3643Bond.sol";

/// @notice Exercises the real ERC-3643 bond: permissioned transfers, primary
///         purchase/accretion, issuer-funded cash coupons, and maturity
///         redemption from the issuer's principal reserve.
contract ERC3643BondTest is Test {
    uint256 internal constant WAD = 1e18;

    TestERC20 internal cash;
    TestIdentityRegistry internal registry;
    TestCompliance internal compliance;
    ERC3643Bond internal bond;

    address internal issuer = address(0xFEE1);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);

    uint256 internal t0;
    uint256 internal maturity;

    function setUp() public {
        t0 = 1_770_000_000;
        vm.warp(t0);
        maturity = t0 + 90 days;

        cash = new TestERC20("USD", "USD", 18);
        registry = new TestIdentityRegistry();
        compliance = new TestCompliance();

        bond = new ERC3643Bond(address(cash), issuer, t0, maturity, 0.95e18, 1e18);
        vm.startPrank(issuer);
        bond.setIdentityRegistry(address(registry));
        bond.setCompliance(address(compliance));
        vm.stopPrank();

        registry.setVerified(alice, true);
        registry.setVerified(bob, true);
        compliance.setAllowed(alice, true);
        compliance.setAllowed(bob, true);

        cash.mint(alice, 1_000_000e18);
        cash.mint(issuer, 1_000_000e18);
    }

    function _purchase(address buyer, uint256 cashIn) internal returns (uint256 bondOut) {
        vm.startPrank(buyer);
        cash.approve(address(bond), type(uint256).max);
        bondOut = bond.purchase(cashIn);
        vm.stopPrank();
    }

    function _fundPrincipal(uint256 amount) internal {
        vm.startPrank(issuer);
        cash.approve(address(bond), type(uint256).max);
        bond.fundPrincipal(amount);
        vm.stopPrank();
    }

    function testPermissionedTransferRejectsUnverifiedRecipient() public {
        uint256 bonds = _purchase(alice, 1_000e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("NotVerified(address)")), carol));
        bond.transfer(carol, bonds);

        // Verify carol and the same transfer succeeds.
        registry.setVerified(carol, true);
        compliance.setAllowed(carol, true);
        vm.prank(alice);
        assertTrue(bond.transfer(carol, bonds));
        assertEq(bond.balanceOf(carol), bonds);
    }

    function testUnverifiedCannotPurchase() public {
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("NotVerified(address)")), carol));
        bond.purchase(1_000e18);
    }

    function testPurchaseAccretesToParAtMaturity() public {
        uint256 bonds = _purchase(alice, 1_000e18);
        assertApproxEqAbs(bond.valueOf(bonds), 1_000e18, 1e15, "marked at cost at issue");

        vm.warp(maturity);
        assertEq(bond.valuePerUnit(), WAD, "par at maturity");

        _fundPrincipal(100e18);
        vm.prank(alice);
        uint256 cashOut = bond.redeemAtMaturity(bonds);
        assertApproxEqAbs(cashOut, (bonds * WAD) / WAD, 1e15);
        assertEq(bond.balanceOf(alice), 0);
    }

    function testIssuerFundedCouponIsClaimableOnce() public {
        uint256 bonds = _purchase(alice, 1_000e18);

        uint256 execution = t0 + 30 days;
        vm.startPrank(issuer);
        uint256 couponId = bond.scheduleCoupon(t0 + 25 days, execution, 0.02e18);
        uint256 target = bond.couponTargetFunding(couponId);
        cash.approve(address(bond), type(uint256).max);
        bond.fundCoupon(couponId, target);
        vm.stopPrank();

        assertEq(bond.claimableCoupon(couponId, alice), 0, "not due before execution date");

        vm.warp(execution);
        uint256 expected = (bonds * 0.02e18) / WAD;
        assertApproxEqAbs(bond.claimableCoupon(couponId, alice), expected, 1e15);

        vm.prank(alice);
        uint256 paid = bond.claimCoupon(couponId);
        assertApproxEqAbs(paid, expected, 1e15);

        vm.prank(alice);
        vm.expectRevert(ERC3643Bond.CouponAlreadyClaimed.selector);
        bond.claimCoupon(couponId);
    }

    function testCouponAndPrincipalBothSettle() public {
        uint256 bonds = _purchase(alice, 1_000e18);

        vm.startPrank(issuer);
        uint256 couponId = bond.scheduleCoupon(t0 + 25 days, t0 + 30 days, 0.02e18);
        cash.approve(address(bond), type(uint256).max);
        bond.fundCoupon(couponId, bond.couponTargetFunding(couponId));
        bond.fundPrincipal(200e18);
        vm.stopPrank();

        vm.warp(t0 + 30 days);
        vm.prank(alice);
        uint256 coupon = bond.claimCoupon(couponId);
        assertGt(coupon, 0);

        vm.warp(maturity);
        _fundPrincipal(200e18);
        vm.prank(alice);
        uint256 principal = bond.redeemAtMaturity(bonds);
        assertGt(principal, 1_000e18, "principal plus accretion");
        assertGe(cash.balanceOf(alice), coupon + principal);
    }
}
