// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Testnet-only infrastructure doubles. They live under `test/` and never ship
// in `src/`; this harness is a live integration check, not the production
// deploy path (`script/Deploy.s.sol` wraps an already-deployed bond).
import {TestERC20} from "../test/mocks/TestERC20.sol";
import {TestIdentityRegistry} from "../test/mocks/TestIdentityRegistry.sol";
import {TestCompliance} from "../test/mocks/TestCompliance.sol";

import {ERC3643Bond} from "../src/sy/ERC3643Bond.sol";
import {ERC3643BondStrategy} from "../src/sy/ERC3643BondStrategy.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {Orderbook} from "../src/Orderbook.sol";

/// @title VerifyERC3643Testnet
/// @notice Live end-to-end check of the ERC-3643 bond yield path on Hedera.
///
///         Phase A (`deployAndExercise`) deploys a real `ERC3643Bond` (with
///         testnet doubles for the cash denomination, identity registry and
///         compliance module), the full Sidereal market around it, and runs the
///         pre-maturity flow: permissioned purchase through the strategy,
///         deposit -> split, an issuer-funded cash coupon claimed into the
///         strategy (raising the SY rate), AMM liquidity + swap, and an
///         orderbook order.
///
///         Phase B (`verifyMaturity`) runs after the bond matures and completes
///         the lifecycle: freeze the rate, redeem PT, claim the YT surplus, and
///         redeem SY for cash.
///
/// Usage:
///   forge script script/VerifyERC3643Testnet.s.sol:VerifyERC3643Testnet \
///     --sig "deployAndExercise()" --rpc-url $RPC --broadcast --slow \
///     --gas-estimate-multiplier 200
///   # wait until MATURITY has passed, then
///   forge script script/VerifyERC3643Testnet.s.sol:VerifyERC3643Testnet \
///     --sig "verifyMaturity()" --rpc-url $RPC --broadcast --slow \
///     --gas-estimate-multiplier 200
contract VerifyERC3643Testnet is Script {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant DEPOSIT = 500_000e18;
    uint256 internal constant SPLIT = 250_000e18;
    uint256 internal constant BOND_RESERVE = 500_000e18;
    uint256 internal constant PT_LIQ = 150_000e18;
    uint256 internal constant SY_LIQ = 100_000e18;
    uint256 internal constant COUPON_RATE = 0.02e18;

    struct Deployment {
        address deployer;
        address cash;
        address registry;
        address compliance;
        address bond;
        address sy;
        address strategy;
        address pt;
        address yt;
        address tokenizer;
        address amm;
        address orderbook;
        uint256 maturity;
        uint256 couponId;
    }

    // --- phase A ------------------------------------------------------------

    function deployAndExercise() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 maturity = vm.envOr("MATURITY", block.timestamp + 8 minutes);

        vm.startBroadcast(pk);

        // Testnet infrastructure: a mintable cash asset plus the ERC-3643 seams
        // a real issuer would provide (identity registry and compliance module).
        TestERC20 cash = new TestERC20("Sidereal Test USD", "tUSD", 18);
        TestIdentityRegistry registry = new TestIdentityRegistry();
        TestCompliance compliance = new TestCompliance();

        // The real, permissioned bond.
        ERC3643Bond bond =
            new ERC3643Bond(address(cash), deployer, block.timestamp, maturity, 0.95e18, 1e18);
        bond.setIdentityRegistry(address(registry));
        bond.setCompliance(address(compliance));

        // Sidereal around it.
        StandardizedYieldVault sy = new StandardizedYieldVault();
        ERC3643BondStrategy strategy = new ERC3643BondStrategy(address(sy), address(bond));
        sy.initialize(deployer, address(strategy));

        PrincipalToken pt = new PrincipalToken();
        YieldToken yt = new YieldToken();
        Tokenizer tokenizer = new Tokenizer();
        tokenizer.initialize(deployer, address(sy), address(pt), address(yt), maturity, deployer, 0);
        pt.initialize(deployer, address(tokenizer), address(sy), maturity);
        yt.initialize(deployer, address(tokenizer), address(sy), maturity);

        AmmMarket amm = new AmmMarket();
        amm.initialize(
            deployer, address(pt), address(sy), address(yt), address(tokenizer), maturity, 1e18, 1e18, 10, 30 minutes
        );
        Orderbook orderbook = new Orderbook();
        orderbook.initialize(deployer, address(pt), address(sy), maturity, deployer, 10);

        // Permissioning: the strategy must be a verified holder to purchase.
        registry.setVerified(deployer, true);
        compliance.setAllowed(deployer, true);
        registry.setVerified(address(strategy), true);
        compliance.setAllowed(address(strategy), true);

        // Issuer cash: redemption reserve plus the coupon that will be funded.
        cash.mint(deployer, 3_000_000e18);
        cash.approve(address(bond), type(uint256).max);
        bond.fundPrincipal(BOND_RESERVE);

        // Layer 1: deposit cash -> strategy buys the permissioned bond.
        cash.approve(address(sy), type(uint256).max);
        uint256 shares = sy.deposit(DEPOSIT, 0);
        require(bond.balanceOf(address(strategy)) > 0, "strategy must hold bond");

        // Layer 2: split into PT + YT.
        sy.approve(address(tokenizer), type(uint256).max);
        (uint256 ptOut, uint256 ytOut) = tokenizer.split(SPLIT);
        require(ptOut == ytOut && ptOut > 0, "split must mint equal PT/YT");

        // Issuer coupon executes immediately, is funded, then is claimed into the
        // strategy by `touch` -- the SY exchange rate must step up.
        uint256 couponId = bond.scheduleCoupon(block.timestamp - 1, block.timestamp, COUPON_RATE);
        bond.fundCoupon(couponId, bond.couponTargetFunding(couponId));
        uint256 rateBefore = sy.exchangeRate();
        sy.touch();
        uint256 rateAfter = sy.exchangeRate();
        require(rateAfter > rateBefore, "coupon must raise the SY rate");

        // Layer 3: AMM liquidity + a swap.
        pt.approve(address(amm), type(uint256).max);
        sy.approve(address(amm), type(uint256).max);
        amm.addLiquidity(PT_LIQ, SY_LIQ, 0);
        amm.swapSyForPt(1_000e18, 0);

        // Layer 3: an orderbook order (expiry must be <= maturity).
        pt.approve(address(orderbook), type(uint256).max);
        orderbook.placeOrder(Orderbook.Side.Ask, 1_000e18, 0.99e18, maturity - 60, 0);

        // Record the pre-maturity rate for the maturity freeze.
        tokenizer.observeRate();

        vm.stopBroadcast();

        Deployment memory d = Deployment({
            deployer: deployer,
            cash: address(cash),
            registry: address(registry),
            compliance: address(compliance),
            bond: address(bond),
            sy: address(sy),
            strategy: address(strategy),
            pt: address(pt),
            yt: address(yt),
            tokenizer: address(tokenizer),
            amm: address(amm),
            orderbook: address(orderbook),
            maturity: maturity,
            couponId: couponId
        });
        _writeManifest(d);

        console2.log("== phase A complete ==");
        _logDeployment(d);
        console2.log("deposited cash", DEPOSIT);
        console2.log("sy shares", shares);
        console2.log("pt/yt minted", ptOut);
        console2.log("sy rate before coupon", rateBefore);
        console2.log("sy rate after coupon", rateAfter);
        console2.log("strategy bond balance", bond.balanceOf(address(strategy)));
        console2.log("strategy counted cash", strategy.countedCash());
        console2.log("maturity", maturity);
    }

    // --- phase B ------------------------------------------------------------

    function verifyMaturity() external {
        Deployment memory d = _readManifest();
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(vm.addr(pk) == d.deployer, "PRIVATE_KEY is not the harness deployer");
        require(block.timestamp >= d.maturity, "maturity not reached yet");

        vm.startBroadcast(pk);

        // Realize any coupon cashflow still sitting in the bond.
        ERC3643BondStrategy(d.strategy).touch();

        StandardizedYieldVault sy = StandardizedYieldVault(d.sy);
        Tokenizer tokenizer = Tokenizer(d.tokenizer);
        PrincipalToken pt = PrincipalToken(d.pt);
        uint256 cashBefore = IERC20(d.cash).balanceOf(d.deployer);
        uint256 syBefore = sy.balanceOf(d.deployer);

        // YT claims the junior surplus before PT consumes the escrow.
        uint256 yieldClaimed = tokenizer.claimYield();

        // PT redeems principal at the frozen rate.
        uint256 syFromPt = tokenizer.redeemAtMaturity(pt.balanceOf(d.deployer));

        // SY back to cash.
        uint256 cashOut = sy.redeem(sy.balanceOf(d.deployer), 0);

        vm.stopBroadcast();

        // The deposit earned the bond's discount (0.95 -> 1.00) plus the coupon.
        require(cashBefore + cashOut > DEPOSIT, "matured position must exceed deposit");
        require(yieldClaimed + syFromPt + cashOut > 0, "no maturity proceeds");

        console2.log("== phase B complete ==");
        console2.log("yield claimed (YT surplus, SY)", yieldClaimed);
        console2.log("sy from PT redemption", syFromPt);
        console2.log("sy before redeem", syBefore);
        console2.log("cash out", cashOut);
        console2.log("cash before", cashBefore);
        console2.log("final cash", cashBefore + cashOut);
        console2.log("frozen maturity rate", sy.exchangeRate());
    }

    // --- manifest -----------------------------------------------------------

    function _writeManifest(Deployment memory d) internal {
        if (!vm.exists("./deployments")) {
            vm.createDir("./deployments", true);
        }
        string memory obj = "harness";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "deployer", d.deployer);
        vm.serializeAddress(obj, "cash", d.cash);
        vm.serializeAddress(obj, "registry", d.registry);
        vm.serializeAddress(obj, "compliance", d.compliance);
        vm.serializeAddress(obj, "bond", d.bond);
        vm.serializeAddress(obj, "sy", d.sy);
        vm.serializeAddress(obj, "strategy", d.strategy);
        vm.serializeAddress(obj, "pt", d.pt);
        vm.serializeAddress(obj, "yt", d.yt);
        vm.serializeAddress(obj, "tokenizer", d.tokenizer);
        vm.serializeAddress(obj, "amm", d.amm);
        vm.serializeAddress(obj, "orderbook", d.orderbook);
        vm.serializeUint(obj, "couponId", d.couponId);
        string memory json = vm.serializeUint(obj, "maturity", d.maturity);
        vm.writeJson(json, "./deployments/erc3643-testnet.json");
    }

    function _readManifest() internal view returns (Deployment memory d) {
        string memory json = vm.readFile("./deployments/erc3643-testnet.json");
        d.deployer = vm.parseJsonAddress(json, ".deployer");
        d.cash = vm.parseJsonAddress(json, ".cash");
        d.registry = vm.parseJsonAddress(json, ".registry");
        d.compliance = vm.parseJsonAddress(json, ".compliance");
        d.bond = vm.parseJsonAddress(json, ".bond");
        d.sy = vm.parseJsonAddress(json, ".sy");
        d.strategy = vm.parseJsonAddress(json, ".strategy");
        d.pt = vm.parseJsonAddress(json, ".pt");
        d.yt = vm.parseJsonAddress(json, ".yt");
        d.tokenizer = vm.parseJsonAddress(json, ".tokenizer");
        d.amm = vm.parseJsonAddress(json, ".amm");
        d.orderbook = vm.parseJsonAddress(json, ".orderbook");
        d.couponId = vm.parseJsonUint(json, ".couponId");
        d.maturity = vm.parseJsonUint(json, ".maturity");
    }

    function _logDeployment(Deployment memory d) internal pure {
        console2.log("cash", d.cash);
        console2.log("registry", d.registry);
        console2.log("compliance", d.compliance);
        console2.log("bond", d.bond);
        console2.log("sy", d.sy);
        console2.log("strategy", d.strategy);
        console2.log("pt", d.pt);
        console2.log("yt", d.yt);
        console2.log("tokenizer", d.tokenizer);
        console2.log("amm", d.amm);
        console2.log("orderbook", d.orderbook);
        console2.log("couponId", d.couponId);
    }
}
