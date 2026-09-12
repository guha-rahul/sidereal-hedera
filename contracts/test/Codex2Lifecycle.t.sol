// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeployATS} from "../script/DeployATS.s.sol";
import {ATSLifecycle} from "../script/ATSLifecycle.s.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {ATSBondAdapter} from "../src/sy/ATSBondAdapter.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {Orderbook} from "../src/Orderbook.sol";

/// @notice Drives every `ATSLifecycle` phase against a market built by the real ATS
///         factory. The demo receipts come from these phases, so a reverting phase
///         must surface here rather than mid-demonstration on testnet.
contract Codex2LifecycleTest is Test, DeployATS {
    uint256 constant ISSUER_KEY = uint256(keccak256("codex2.fork.issuer"));
    uint256 constant BUYER_KEY = uint256(keccak256("codex2.fork.buyer"));
    // Distinct manifest files: forge runs test functions concurrently, so two tests
    // writing one path would race on the file as well as on the phase selection.
    string constant PATH_FULL = "deployments/codex2-fork-lifecycle.json";
    string constant PATH_ACCESS = "deployments/codex2-fork-access.json";

    function testEveryLifecyclePhaseRunsAgainstDeployedMarket() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) { vm.skip(true); return; }
        address issuer = vm.addr(ISSUER_KEY);
        address buyer = vm.addr(BUYER_KEY);
        vm.createSelectFork("https://testnet.hashio.io/api", 40433521);
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
        runner.runPhase("coupon", ISSUER_KEY, PATH_FULL);
        assertTrue(ATSBondAdapter(m.adapter).couponClaimed(0), "coupon must be claimed by upkeep");

        vm.warp(m.maturity);
        uint256 issuerCashBefore = IERC20(m.cash).balanceOf(issuer);
        uint256 buyerCashBefore = IERC20(m.cash).balanceOf(buyer);
        runner.runPhase("settle", ISSUER_KEY, PATH_FULL);
        runner.runPhase("settle", BUYER_KEY, PATH_FULL);
        assertGt(IERC20(m.cash).balanceOf(issuer), issuerCashBefore, "issuer settles to cash");
        assertGt(IERC20(m.cash).balanceOf(buyer), buyerCashBefore, "buyer settles to cash");
        assertEq(IERC20(m.pt).balanceOf(buyer), 0, "buyer PT fully redeemed");
        console2.log("buyer net cash", IERC20(m.cash).balanceOf(buyer) - buyerCashBefore);
    }

    /// @notice Eligibility is revocable and the demo shows a rejected operation.
    function testRevokePhaseBlocksBuyerThenReinstateRestores() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) { vm.skip(true); return; }
        address issuer = vm.addr(ISSUER_KEY);
        address buyer = vm.addr(BUYER_KEY);
        vm.createSelectFork("https://testnet.hashio.io/api", 40433521);
        vm.startPrank(issuer);
        Market memory m = _deploy(issuer, buyer, 1800, 600);
        vm.stopPrank();
        _manifest(m, PATH_ACCESS);
        ATSLifecycle runner = new ATSLifecycle();

        runner.runPhase("revoke", ISSUER_KEY, PATH_ACCESS);
        assertFalse(StandardizedYieldVault(m.sy).isEligible(buyer), "revoked buyer is ineligible");
        vm.startPrank(buyer);
        IERC20(m.cash).approve(m.sy, 1_000e6);
        vm.expectRevert(abi.encodeWithSignature("NotEligible(address)", buyer));
        StandardizedYieldVault(m.sy).deposit(950e6, 0);
        vm.stopPrank();

        runner.runPhase("reinstate", ISSUER_KEY, PATH_ACCESS);
        assertTrue(StandardizedYieldVault(m.sy).isEligible(buyer), "reinstated buyer is eligible");
        vm.startPrank(buyer);
        assertGt(StandardizedYieldVault(m.sy).deposit(950e6, 0), 0, "reinstated deposit succeeds");
        vm.stopPrank();
    }
}
