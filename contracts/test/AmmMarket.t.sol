// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {MarketFixture} from "./MarketFixture.sol";
import {AmmMarket} from "../src/AmmMarket.sol";

contract AmmMarketTest is MarketFixture {
    AmmMarket internal amm;

    address internal admin = address(0xA11CE);
    address internal alice = address(0xA11CE1);
    address internal bob = address(0xB0B);
    address internal feeRecipient = address(0xFEE);

    function setUp() public {
        _setUpMarket(admin, feeRecipient, 1_000_000e18);

        amm = new AmmMarket();
        _verify(address(amm));
        amm.initialize(
            admin,
            address(pt),
            address(sy),
            address(yt),
            address(tokenizer),
            maturity,
            1e18, // scalarRoot
            WAD, // initialAnchor
            10, // 0.10% fee
            30 minutes
        );

        _seed();
    }

    function _seed() internal {
        cash.mint(alice, 1_000_000e18);
        vm.startPrank(alice);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(tokenizer), type(uint256).max);
        sy.approve(address(amm), type(uint256).max);
        pt.approve(address(amm), type(uint256).max);
        sy.deposit(20_000e18, 0);
        tokenizer.split(10_000e18);
        // Seed PT-heavy (60/40) so the curve prices PT at a discount to SY;
        // a 50/50 seed sits on the curve's `exchangeRate >= WAD` boundary and
        // admits no PT buys at all.
        amm.addLiquidity((pt.balanceOf(alice) * 6) / 10, (sy.balanceOf(alice) * 4) / 10, 0);
        vm.stopPrank();
    }

    function testSeedSetsReservesAndTwapWarmup() public {
        assertGt(amm.totalLp(), 0);
        assertGt(amm.reservePt(), 0);
        assertGt(amm.reserveSy(), 0);
        assertTrue(amm.twapWarmingUp(), "a freshly seeded market is warming up");
    }

    function testSwapSyForPtThenBack() public {
        vm.warp(t0 + 15 days);
        cash.mint(bob, 100_000e18);
        vm.startPrank(bob);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(amm), type(uint256).max);
        sy.deposit(1_000e18, 0);
        vm.stopPrank();

        uint256 syIn = 1_000e18;
        uint256 quoted = amm.quoteSyForPt(syIn);
        assertGt(quoted, 0);

        vm.prank(bob);
        uint256 ptOut = amm.swapSyForPt(syIn, quoted);
        assertGe(ptOut, quoted);
        assertEq(pt.balanceOf(bob), ptOut);

        // Sell the PT back; a round trip at the same instant should be close.
        vm.startPrank(bob);
        pt.approve(address(amm), type(uint256).max);
        uint256 backOut = amm.swapPtForSy(ptOut, 0);
        vm.stopPrank();
        assertGt(backOut, 0);
        assertApproxEqRel(backOut, syIn, 0.2e18, "round trip within 20%");
    }

    function testBuyAndSellYt() public {
        cash.mint(bob, 100_000e18);
        vm.startPrank(bob);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(amm), type(uint256).max);
        sy.deposit(1_000e18, 0);
        vm.stopPrank();

        uint256 budget = 1_000e18;
        uint256 quotedYt = amm.quoteSyForYt(budget);
        assertGt(quotedYt, 0, "YT buy must quote a positive amount");

        vm.prank(bob);
        uint256 ytOut = amm.swapSyForYt(budget, quotedYt);
        assertGe(ytOut, quotedYt);
        assertEq(yt.balanceOf(bob), ytOut);

        vm.startPrank(bob);
        yt.approve(address(amm), type(uint256).max);
        uint256 quotedSy = amm.quoteYtForSy(ytOut / 2);
        uint256 syBack = amm.swapYtForSy(ytOut / 2, quotedSy);
        vm.stopPrank();
        assertGe(syBack, quotedSy);
        assertGt(syBack, 0);
    }

    function testAddAndRemoveLiquidity() public {
        vm.warp(t0 + 10 days);
        uint256 ptBefore = pt.balanceOf(alice);
        (uint256 reservePt, uint256 reserveSy) = (amm.reservePt(), amm.reserveSy());

        vm.startPrank(alice);
        uint256 lpOut = amm.addLiquidity(ptBefore / 4, sy.balanceOf(alice) / 4, 0);
        vm.stopPrank();
        assertGt(lpOut, 0);

        (uint256 newReservePt, uint256 newReserveSy) = (amm.reservePt(), amm.reserveSy());
        assertGt(newReservePt, reservePt);
        assertGt(newReserveSy, reserveSy);

        vm.prank(alice);
        (uint256 ptOut, uint256 syOut) = amm.removeLiquidity(lpOut, 0, 0);
        assertGt(ptOut, 0);
        assertGt(syOut, 0);
    }

    function testTwapReArmsOnSeedAndUpdates() public {
        assertTrue(amm.twapWarmingUp());
        // Several swaps spread over time feed the TWAP.
        cash.mint(bob, 100_000e18);
        vm.startPrank(bob);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(amm), type(uint256).max);
        sy.deposit(2_000e18, 0);
        sy.approve(address(amm), type(uint256).max);
        amm.swapSyForPt(500e18, 0);
        vm.warp(t0 + 10 minutes);
        amm.swapSyForPt(500e18, 0);
        vm.warp(t0 + 20 minutes);
        amm.swapSyForPt(500e18, 0);
        vm.warp(t0 + 30 minutes);
        amm.swapSyForPt(500e18, 0);
        vm.stopPrank();

        assertFalse(amm.twapWarmingUp(), "a full window of observations clears warm-up");
        assertGt(amm.twapApy(), 0);
    }

    function testSwapRejectsAfterMaturity() public {
        vm.warp(maturity);
        vm.prank(bob);
        vm.expectRevert(AmmMarket.MarketMatured.selector);
        amm.swapSyForPt(1e18, 0);
    }
}
