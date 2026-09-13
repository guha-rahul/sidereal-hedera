// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeployATS} from "../script/DeployATS.s.sol";
import {ATSLifecycle} from "../script/ATSLifecycle.s.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {ATSBondAdapter} from "../src/sy/ATSBondAdapter.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {Orderbook} from "../src/Orderbook.sol";

/// @notice Drives every `ATSLifecycle` phase against a market built by the real ATS
///         factory. The demo receipts come from these phases, so a reverting phase
///         must surface here rather than mid-demonstration on testnet.
contract ATSLifecycleTest is Test, DeployATS {
    uint256 constant ISSUER_KEY = uint256(keccak256("sidereal.fork.issuer"));
    uint256 constant BUYER_KEY = uint256(keccak256("sidereal.fork.buyer"));
    // Distinct manifest files: forge runs test functions concurrently, so two tests
    // writing one path would race on the file as well as on the phase selection.
    string constant PATH_FULL = "deployments/ats-fork-lifecycle.json";
    string constant PATH_ACCESS = "deployments/ats-fork-access.json";

    /// @notice A live bond accrues value every second, so by the time a real
    ///         seed broadcasts the SY rate is usually above 1. The AMM rejects a
    ///         50/50 first seed at that rate; a PT-heavy seed must still open it.
    function testSeedAfterBondStartRequiresPtHeavyLiquidity() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) { vm.skip(true); return; }
        address issuer = vm.addr(ISSUER_KEY);
        address buyer = vm.addr(BUYER_KEY);
        vm.createSelectFork("https://testnet.hashio.io/api", vm.envOr("ATS_FORK_BLOCK", uint256(40433521)));
        vm.startPrank(issuer);
        Market memory m = _deploy(issuer, buyer, 1800, 600);
        IERC20(m.cash).approve(m.sy, 4_000e6);
        StandardizedYieldVault(m.sy).deposit(4_000e6, 0);
        IERC20(m.sy).approve(m.tokenizer, 2_000e18);
        Tokenizer(m.tokenizer).split(2_000e18);
        vm.stopPrank();

        vm.warp(m.startingDate + 300);
        assertGt(StandardizedYieldVault(m.sy).exchangeRate(), 1e18, "bond must accrue before this test");

        vm.startPrank(issuer);
        IERC20(m.pt).approve(m.amm, 1_200e18);
        IERC20(m.sy).approve(m.amm, 800e18);
        vm.expectRevert(AmmMarket.ExchangeRateBelowOne.selector);
        AmmMarket(m.amm).addLiquidity(1_000e18, 1_000e18, 0);
        assertGt(AmmMarket(m.amm).addLiquidity(1_200e18, 800e18, 0), 0, "PT-heavy seed opens the market");
        vm.stopPrank();
    }

    function testEveryLifecyclePhaseRunsAgainstDeployedMarket() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) { vm.skip(true); return; }
        address issuer = vm.addr(ISSUER_KEY);
        address buyer = vm.addr(BUYER_KEY);
        vm.createSelectFork("https://testnet.hashio.io/api", vm.envOr("ATS_FORK_BLOCK", uint256(40433521)));
        vm.startPrank(issuer);
        Market memory m = _deploy(issuer, buyer, 1800, 600);
        vm.stopPrank();
        _manifest(m, PATH_FULL);
        ATSLifecycle runner = new ATSLifecycle();

        runner.runPhase("seed", ISSUER_KEY, PATH_FULL);
        assertGt(AmmMarket(m.amm).reservePt(), 0, "seed must leave AMM PT liquidity");
        assertGt(AmmMarket(m.amm).reserveSy(), 0, "seed must leave AMM SY liquidity");
        assertGt(Orderbook(m.orderbook).bestOrder(Orderbook.Side.Ask).remainingBase, 0, "resting ask");

        uint256 buyerPtBefore = IERC20(m.pt).balanceOf(buyer);
        runner.runPhase("trade", BUYER_KEY, PATH_FULL);
        assertGt(IERC20(m.pt).balanceOf(buyer), buyerPtBefore, "buyer must end up holding PT");

        vm.warp(m.executionDate);
        uint256 reserveBefore = ATSBondAdapter(m.adapter).couponReserve(0);
        uint256 strategyCashBefore = IERC20(m.cash).balanceOf(m.strategy);
        runner.runPhase("coupon", ISSUER_KEY, PATH_FULL);
        uint256 couponPaid = reserveBefore - ATSBondAdapter(m.adapter).couponReserve(0);
        assertGt(couponPaid, 0, "coupon actually pays cash");
        assertEq(IERC20(m.cash).balanceOf(m.strategy) - strategyCashBefore, couponPaid,
            "coupon reserve debit equals strategy cash credit");
        assertTrue(ATSBondAdapter(m.adapter).couponClaimed(0), "coupon must be claimed by upkeep");

        vm.warp(m.maturity);
        uint256 issuerCashBefore = IERC20(m.cash).balanceOf(issuer);
        uint256 buyerCashBefore = IERC20(m.cash).balanceOf(buyer);
        runner.runPhase("settle", ISSUER_KEY, PATH_FULL);
        runner.runPhase("settle", BUYER_KEY, PATH_FULL);
        assertGt(IERC20(m.cash).balanceOf(issuer), issuerCashBefore, "issuer settles to cash");
        assertGt(IERC20(m.cash).balanceOf(buyer), buyerCashBefore, "buyer settles to cash");
        assertEq(IERC20(m.pt).balanceOf(buyer), 0, "buyer PT fully redeemed");
        assertEq(IERC20(m.pt).balanceOf(issuer), 0, "issuer PT fully redeemed");
        assertEq(IERC20(m.sy).balanceOf(issuer), 0, "issuer SY fully redeemed");
        assertEq(IERC20(m.sy).balanceOf(buyer), 0, "buyer SY fully redeemed");
        address[10] memory holders = [issuer,buyer,m.adapter,m.strategy,m.sy,m.pt,m.yt,m.tokenizer,m.amm,m.orderbook];
        uint256 totalCash;
        for (uint256 i; i < holders.length; i++) totalCash += IERC20(m.cash).balanceOf(holders[i]);
        assertEq(totalCash, 100_000e6, "all issued demo cash reconciles after settlement");
        console2.log("buyer net cash", IERC20(m.cash).balanceOf(buyer) - buyerCashBefore);
    }

    /// @notice Eligibility is revocable and the demo shows a rejected operation.
    function testRevokePhaseBlocksBuyerThenReinstateRestores() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) { vm.skip(true); return; }
        address issuer = vm.addr(ISSUER_KEY);
        address buyer = vm.addr(BUYER_KEY);
        vm.createSelectFork("https://testnet.hashio.io/api", vm.envOr("ATS_FORK_BLOCK", uint256(40433521)));
        vm.startPrank(issuer);
        Market memory m = _deploy(issuer, buyer, 1800, 600);
        vm.stopPrank();
        _manifest(m, PATH_ACCESS);
        ATSLifecycle runner = new ATSLifecycle();

        vm.startPrank(buyer);
        IERC20(m.cash).approve(m.sy, 2_000e6);
        uint256 shares = StandardizedYieldVault(m.sy).deposit(950e6, 0);
        IERC20(m.sy).approve(m.tokenizer, shares / 2);
        Tokenizer(m.tokenizer).split(shares / 2);
        vm.stopPrank();
        runner.runPhase("revoke", ISSUER_KEY, PATH_ACCESS);
        assertFalse(StandardizedYieldVault(m.sy).isEligible(buyer), "revoked buyer is ineligible");
        vm.startPrank(buyer);
        bytes memory denied = abi.encodeWithSignature("NotEligible(address)", buyer);
        vm.expectRevert(denied);
        IERC20(m.sy).transfer(issuer, 1);
        vm.expectRevert(denied);
        IERC20(m.pt).transfer(issuer, 1);
        vm.expectRevert(denied);
        IERC20(m.yt).transfer(issuer, 1);
        vm.expectRevert(denied);
        StandardizedYieldVault(m.sy).redeem(1e18, 0);
        vm.expectRevert(denied);
        Tokenizer(m.tokenizer).recombine(1e18, 1e18);
        vm.expectRevert(abi.encodeWithSignature("NotEligible(address)", buyer));
        StandardizedYieldVault(m.sy).deposit(950e6, 0);
        vm.stopPrank();

        runner.runPhase("reinstate", ISSUER_KEY, PATH_ACCESS);
        assertTrue(StandardizedYieldVault(m.sy).isEligible(buyer), "reinstated buyer is eligible");
        vm.startPrank(buyer);
        assertGt(StandardizedYieldVault(m.sy).deposit(950e6, 0), 0, "reinstated deposit succeeds");
        vm.stopPrank();
        vm.warp(m.maturity);
        runner.runPhase("revoke", ISSUER_KEY, PATH_ACCESS);
        vm.startPrank(buyer);
        vm.expectRevert(denied);
        Tokenizer(m.tokenizer).redeemAtMaturity(1e18);
        vm.stopPrank();
        runner.runPhase("reinstate", ISSUER_KEY, PATH_ACCESS);
        vm.prank(buyer);
        assertGt(Tokenizer(m.tokenizer).redeemAtMaturity(1e18), 0, "reinstated maturity exit succeeds");
    }
}
