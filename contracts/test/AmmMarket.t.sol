// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockTokenizedBond} from "../src/sy/MockTokenizedBond.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {BondStrategy} from "../src/sy/BondStrategy.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {AmmMarket} from "../src/AmmMarket.sol";

contract AmmMarketTest is Test {
    uint256 internal constant WAD = 1e18;

    MockERC20 internal cash;
    MockTokenizedBond internal bond;
    StandardizedYieldVault internal sy;
    BondStrategy internal strategy;
    PrincipalToken internal pt;
    YieldToken internal yt;
    Tokenizer internal tokenizer;
    AmmMarket internal amm;

    address internal admin = address(0xA11CE);
    address internal alice = address(0xA11CE1);
    address internal bob = address(0xB0B);
    address internal feeRecipient = address(0xFEE);

    uint256 internal t0;
    uint256 internal maturity;

    function setUp() public {
        t0 = 1_770_000_000;
        vm.warp(t0);
        maturity = t0 + 90 days;

        cash = new MockERC20("USD", "USD", 18);
        bond = new MockTokenizedBond(address(cash), t0, maturity, 0.95e18, 1e18);
        cash.mint(address(this), 2_000_000e18);
        cash.transfer(address(bond), 1_000_000e18);

        sy = new StandardizedYieldVault();
        strategy = new BondStrategy(address(sy), address(bond));
        sy.initialize(admin, address(strategy));

        pt = new PrincipalToken();
        yt = new YieldToken();
        tokenizer = new Tokenizer();
        tokenizer.initialize(
            admin, address(sy), address(pt), address(yt), maturity, feeRecipient, 0
        );
        pt.initialize(admin, address(tokenizer), address(sy), maturity);
        yt.initialize(admin, address(tokenizer), address(sy), maturity);

        amm = new AmmMarket();
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
