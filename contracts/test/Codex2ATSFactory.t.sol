// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {DeployATS} from "../script/DeployATS.s.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {ATSBondAdapter} from "../src/sy/ATSBondAdapter.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IATSBond} from "../src/interfaces/IATSBond.sol";
import {IATSAdmin} from "../script/ats/IATSFactory.sol";
import {ERC3643BondStrategy} from "../src/sy/ERC3643BondStrategy.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {Orderbook} from "../src/Orderbook.sol";

contract Codex2ATSFactoryTest is Test, DeployATS {
    address constant ISSUER = address(0xA11CE);
    address constant BUYER = address(0xB0B);

    function testRealFactoryIssuanceAndPaidLifecycleOnFork() public {
        if (!vm.envOr("RUN_ATS_LIVE",false)) { vm.skip(true); return; }
        vm.createSelectFork("https://testnet.hashio.io/api",40433521);
        address issuer = address(0xA11CE);
        address buyer = address(0xB0B);
        vm.startPrank(issuer);
        Market memory m = _deploy(issuer,buyer,1800,600);
        IERC20(m.cash).approve(m.sy,1_000e6);
        uint256 shares = StandardizedYieldVault(m.sy).deposit(950e6,0);
        IERC20(m.sy).approve(m.tokenizer,shares);
        Tokenizer(m.tokenizer).split(shares);
        vm.stopPrank();
        assertGt(IERC20(m.security).balanceOf(m.strategy),0);
        vm.warp(m.executionDate);
        StandardizedYieldVault(m.sy).touch();
        assertTrue(ATSBondAdapter(m.adapter).couponClaimed(0));
        vm.warp(m.maturity);
        uint256 face = IERC20(m.pt).balanceOf(issuer);
        vm.startPrank(issuer);
        uint256 principalShares = Tokenizer(m.tokenizer).redeemAtMaturity(face);
        uint256 principalCash = StandardizedYieldVault(m.sy).redeem(principalShares,0);
        vm.stopPrank();
        assertApproxEqAbs(principalCash,face/1e12,2);
    }

    /// @dev Every check below runs against a market built by the real ATS factory
    ///      through the same `_deploy` the broadcast script uses, so a wiring or
    ///      timing mistake fails here instead of after spending testnet HBAR.
    function _fork() internal returns (Market memory m) {
        vm.createSelectFork("https://testnet.hashio.io/api", 40433521);
        vm.startPrank(ISSUER);
        m = _deploy(ISSUER, BUYER, 1800, 600);
        vm.stopPrank();
    }

    /// @notice The broadcast run ends by writing the manifest. If that write fails,
    ///         the deployed addresses are lost, so prove the path is writable and
    ///         every field round-trips before the live run.
    function testManifestRoundTripCapturesDeployedAddresses() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) { vm.skip(true); return; }
        Market memory m = _fork();
        string memory path = "deployments/codex2-fork-manifest.json";
        _manifest(m, path);
        string memory json = vm.readFile(path);
        assertEq(vm.parseJsonAddress(json, ".security"), m.security, "security");
        assertEq(vm.parseJsonAddress(json, ".bond"), m.adapter, "BOND must be the adapter");
        assertEq(vm.parseJsonAddress(json, ".adapter"), m.adapter, "adapter");
        assertEq(vm.parseJsonAddress(json, ".strategy"), m.strategy, "strategy");
        assertEq(vm.parseJsonAddress(json, ".sy"), m.sy, "sy");
        assertEq(vm.parseJsonAddress(json, ".pt"), m.pt, "pt");
        assertEq(vm.parseJsonAddress(json, ".yt"), m.yt, "yt");
        assertEq(vm.parseJsonAddress(json, ".tokenizer"), m.tokenizer, "tokenizer");
        assertEq(vm.parseJsonAddress(json, ".amm"), m.amm, "amm");
        assertEq(vm.parseJsonAddress(json, ".orderbook"), m.orderbook, "orderbook");
        assertEq(vm.parseJsonAddress(json, ".cash"), m.cash, "cash");
        assertEq(vm.parseJsonAddress(json, ".issuer"), m.issuer, "issuer");
        assertEq(vm.parseJsonAddress(json, ".buyer"), m.buyer, "buyer");
        assertEq(vm.parseJsonAddress(json, ".factory"), FACTORY, "factory");
        assertEq(vm.parseJsonAddress(json, ".resolver"), RESOLVER, "resolver");
        // ATSLifecycle.s.sol reads exactly these keys; a rename breaks every phase.
        assertEq(vm.parseJsonUint(json, ".startingDate"), m.startingDate, "startingDate");
        assertEq(vm.parseJsonUint(json, ".recordDate"), m.recordDate, "recordDate");
        assertEq(vm.parseJsonUint(json, ".executionDate"), m.executionDate, "executionDate");
        assertEq(vm.parseJsonUint(json, ".maturity"), m.maturity, "maturity");
        assertEq(vm.parseJsonUint(json, ".chainId"), block.chainid, "chainId");
    }

    /// @notice One maturity must hold across the ATS bond and every derivative venue.
    ///         A mismatch silently breaks settlement rather than reverting.
    function testDeployedMarketSharesOneMaturityAndDeclaredDecimals() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) { vm.skip(true); return; }
        Market memory m = _fork();
        uint256 maturity = IATSBond(m.security).getBondDetails().maturityDate;
        assertEq(maturity, m.maturity, "ATS bond maturity");
        assertEq(ATSBondAdapter(m.adapter).maturity(), maturity, "adapter");
        assertEq(ERC3643BondStrategy(m.strategy).maturity(), maturity, "strategy");
        assertEq(StandardizedYieldVault(m.sy).maturity(), maturity, "sy");
        assertEq(Tokenizer(m.tokenizer).maturity(), maturity, "tokenizer");
        assertEq(PrincipalToken(m.pt).maturity(), maturity, "pt");
        assertEq(YieldToken(m.yt).maturity(), maturity, "yt");
        assertEq(AmmMarket(m.amm).maturity(), maturity, "amm");
        assertEq(Orderbook(m.orderbook).maturity(), maturity, "orderbook");
        assertGt(maturity, IATSBond(m.security).getBondDetails().startingDate, "term must be positive");

        // Cash is six-decimal demo cash; claims are eighteen-decimal. Anything that
        // formats adapter cash figures as WAD would misprice by 1e12.
        assertEq(IERC20Metadata(m.cash).decimals(), 6, "cash decimals");
        assertEq(IERC20Metadata(m.security).decimals(), 6, "ATS security decimals");
        assertEq(IERC20Metadata(m.sy).decimals(), 18, "sy decimals");
        assertEq(IERC20Metadata(m.pt).decimals(), 18, "pt decimals");
        assertEq(IERC20Metadata(m.yt).decimals(), 18, "yt decimals");
        assertEq(ATSBondAdapter(m.adapter).securityToken(), m.security, "adapter points at ATS asset");
    }

    /// @notice The demo must show a rejected ineligible operation. Prove the
    ///         rejection comes from the deployed configuration, not from the UI.
    function testIneligibleOutsiderCannotEnterDeployedMarket() public {
        if (!vm.envOr("RUN_ATS_LIVE", false)) { vm.skip(true); return; }
        Market memory m = _fork();
        address outsider = address(0x0115E4);
        assertFalse(ATSBondAdapter(m.adapter).isVerified(outsider), "outsider must lack ATS KYC");
        assertFalse(StandardizedYieldVault(m.sy).isEligible(outsider), "SY must refuse the outsider");

        // The outsider holds spendable cash, so only the permission check can stop it.
        vm.prank(ISSUER);
        IERC20(m.cash).transfer(outsider, 1_000e6);
        vm.startPrank(outsider);
        IERC20(m.cash).approve(m.sy, 1_000e6);
        vm.expectRevert(abi.encodeWithSignature("NotEligible(address)", outsider));
        StandardizedYieldVault(m.sy).deposit(950e6, 0);
        vm.stopPrank();

        // Granting eligibility opens the same call: the gate is the policy, not a bug.
        vm.prank(ISSUER);
        IATSAdmin(m.security).grantKyc(outsider, "testnet-demo-eligibility", 0, m.maturity + 365 days, ISSUER);
        vm.startPrank(outsider);
        assertGt(StandardizedYieldVault(m.sy).deposit(950e6, 0), 0, "eligible deposit must succeed");
        vm.stopPrank();
    }
}
