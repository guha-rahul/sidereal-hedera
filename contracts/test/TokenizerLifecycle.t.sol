// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {MarketFixture} from "./MarketFixture.sol";
import {Tokenizer} from "../src/Tokenizer.sol";

contract TokenizerLifecycleTest is MarketFixture {
    address internal admin = address(0xA11CE);
    address internal alice = address(0xB0B);
    address internal feeRecipient = address(0xFEE);

    function setUp() public {
        _setUpMarket(admin, feeRecipient, 500_000e18);

        cash.mint(alice, 1_000_000e18);
        vm.startPrank(alice);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(tokenizer), type(uint256).max);
        vm.stopPrank();
    }

    function _depositAndSplit(uint256 amount) internal returns (uint256 shares, uint256 face) {
        vm.prank(alice);
        shares = sy.deposit(amount, 0);
        (uint256 ptOut, uint256 ytOut) = tokenizer.previewSplit(shares);
        vm.prank(alice);
        (uint256 p, uint256 y) = tokenizer.split(shares);
        assertEq(p, ptOut);
        assertEq(y, ytOut);
        assertEq(pt.balanceOf(alice), p);
        assertEq(yt.balanceOf(alice), y);
        assertEq(tokenizer.escrowedSy(), shares);
        face = p;
    }

    function testDepositSplitAndEscrow() public {
        (uint256 shares, uint256 face) = _depositAndSplit(1000e18);
        assertApproxEqAbs(shares, 1000e18, 1e15);
        assertApproxEqAbs(face, shares, 1e15);
        assertEq(sy.totalSupply(), shares + sy.MINIMUM_SHARES());
    }

    function testYieldAccruesToYtAndIsClaimable() public {
        _depositAndSplit(1000e18);
        vm.warp(t0 + 30 days);

        uint256 rate = sy.exchangeRate();
        assertGt(rate, WAD, "rate must rise as the bond accretes");

        uint256 pending = yt.previewClaimYield(alice);
        assertGt(pending, 0, "YT must have accrued yield");

        vm.prank(alice);
        uint256 net = tokenizer.claimYield();
        assertGt(net, 0);
        assertEq(sy.balanceOf(alice), net);
        assertEq(yt.accruedYield(alice), 0, "claim consumes the banked ledger");
    }

    function testPtRedeemsPrincipalAtMaturity() public {
        _depositAndSplit(1000e18);
        // A keeper pokes the observation just before maturity so the frozen rate
        // reflects the full accrual (the unobserved tail otherwise favours PT).
        vm.warp(maturity - 1);
        tokenizer.observeRate();
        vm.warp(maturity);

        uint256 ptBal = pt.balanceOf(alice);
        vm.prank(alice);
        uint256 syOut = tokenizer.redeemAtMaturity(ptBal);

        vm.prank(alice);
        uint256 cashOut = sy.redeem(syOut, 0);
        assertApproxEqAbs(cashOut, 1000e18, 1e15, "PT must return principal in full");
        assertEq(pt.balanceOf(alice), 0);
    }

    function testClaimAndRedeemDrainEscrowWithNoShortfall() public {
        _depositAndSplit(1000e18);
        vm.warp(maturity - 1);
        tokenizer.observeRate();
        vm.warp(maturity);

        // YT holder claims the junior surplus; PT is senior and unaffected.
        vm.prank(alice);
        tokenizer.claimYield();
        uint256 ptBal = pt.balanceOf(alice);
        vm.prank(alice);
        tokenizer.redeemAtMaturity(ptBal);

        // Residual escrow must be dust only: everything was accounted for.
        assertLt(tokenizer.escrowedSy(), 1e9, "escrow should be drained to dust");
    }

    function testRecombineReturnsPrincipalAndBanksYield() public {
        _depositAndSplit(1000e18);
        vm.warp(t0 + 30 days);

        uint256 ptBal = pt.balanceOf(alice);
        uint256 ytBal = yt.balanceOf(alice);
        vm.prank(alice);
        uint256 syOut = tokenizer.recombine(ptBal, ytBal);

        // Recombine returns principal in SY terms; the accrued yield stays
        // banked on the YT ledger even though the YT was burned.
        uint256 banked = yt.accruedYield(alice);
        assertGt(banked, 0, "burn hook settles the YT before burning");

        uint256 rate = sy.exchangeRate();
        vm.prank(alice);
        uint256 cashOut = sy.redeem(syOut, 0);
        assertApproxEqAbs(cashOut, 1000e18, 1e16, "recombine returns principal");
        assertGt(banked, 0);
        assertGt(rate, WAD);
    }

    function testSplitRejectsAfterMaturity() public {
        vm.warp(maturity);
        vm.expectRevert(Tokenizer.Matured.selector);
        vm.prank(alice);
        tokenizer.split(1e18);
    }
}
