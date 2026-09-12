// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockTokenizedBond} from "../src/sy/MockTokenizedBond.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {BondStrategy} from "../src/sy/BondStrategy.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {Orderbook} from "../src/Orderbook.sol";

/// @title LifecyclePre
/// @notice Phase 1 of the full lifecycle: deploy a market with a short maturity
///         and run every pre-maturity flow, ending by distributing a bond coupon
///         and observing the resulting SY rate. Phase 2
///         (`LifecyclePost.s.sol`) runs after maturity and redeems/claims.
/// @dev The bond is issued at par and pays its yield as an explicit coupon, so
///      the SY rate steps once and is stable, which makes the maturity
///      settlement exactly reconcilable.
contract LifecyclePre is Script {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant MATURITY_DELAY = 300; // seconds

    function _slipped(uint256 value) internal pure returns (uint256) {
        return (value * 99) / 100;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 now_ = block.timestamp;
        uint256 maturity = now_ + MATURITY_DELAY;

        console2.log("=== PHASE 1: pre-maturity ===");
        console2.log("Deployer", deployer);
        console2.log("Chain", block.chainid);
        console2.log("Maturity", maturity);

        vm.startBroadcast(pk);

        // 1. Cash and a par-issued bond that pays an explicit coupon.
        MockERC20 cash = new MockERC20("Hedera Test USD", "hUSD", 18);
        MockTokenizedBond bond = new MockTokenizedBond(address(cash), now_, maturity, 1e18, 1e18);
        cash.mint(deployer, 1_000_000e18);
        cash.transfer(address(bond), 500_000e18);

        // 2. SY vault on the bond strategy.
        StandardizedYieldVault sy = new StandardizedYieldVault();
        BondStrategy strategy = new BondStrategy(address(sy), address(bond));
        sy.initialize(deployer, address(strategy));

        // 3. PT/YT/tokenizer.
        PrincipalToken pt = new PrincipalToken();
        YieldToken yt = new YieldToken();
        Tokenizer tokenizer = new Tokenizer();
        tokenizer.initialize(deployer, address(sy), address(pt), address(yt), maturity, deployer, 0);
        pt.initialize(deployer, address(tokenizer), address(sy), maturity);
        yt.initialize(deployer, address(tokenizer), address(sy), maturity);

        // 4. AMM + orderbook.
        AmmMarket amm = new AmmMarket();
        amm.initialize(deployer, address(pt), address(sy), address(yt), address(tokenizer), maturity, 1e18, WAD, 10, 30 minutes);
        Orderbook book = new Orderbook();
        book.initialize(deployer, address(pt), address(sy), maturity, deployer, 10);

        // 5. Approvals.
        cash.approve(address(sy), type(uint256).max);
        cash.approve(address(bond), type(uint256).max);
        sy.approve(address(tokenizer), type(uint256).max);
        sy.approve(address(amm), type(uint256).max);
        pt.approve(address(amm), type(uint256).max);
        yt.approve(address(amm), type(uint256).max);
        pt.approve(address(book), type(uint256).max);
        sy.approve(address(book), type(uint256).max);

        // 6. Deposit and split.
        uint256 shares = sy.deposit(1_000e18, 0);
        console2.log("SY minted", shares);
        (uint256 pt0,) = tokenizer.split(300e18);
        tokenizer.split(300e18);
        console2.log("PT/YT minted", pt0 * 2);
        require(pt.balanceOf(deployer) >= 600e18, "split failed");

        // 7. Seed the AMM PT-heavy (60/40) so PT prices at a discount.
        uint256 seedLp = amm.addLiquidity(
            (pt.balanceOf(deployer) * 6) / 10,
            (sy.balanceOf(deployer) * 4) / 10,
            0
        );
        require(seedLp > 0, "seed failed");
        console2.log("LP minted", seedLp);

        // 8. Swaps. Only the buy routes here: at a 5-minute horizon the AMM's
        //    rateScalar is so large that PT barely leaves par, and the YT-sell
        //    route cannot clear its own fee. That route is covered by the
        //    90-day VerifyTestnet run.
        uint256 syIn = 20e18;
        uint256 boughtPt = amm.swapSyForPt(syIn, _slipped(amm.quoteSyForPt(syIn)));
        require(boughtPt > 0, "SY->PT failed");
        console2.log("SY->PT", boughtPt);
        require(amm.swapPtForSy(boughtPt / 2, 0) > 0, "PT->SY failed");
        uint256 boughtYt = amm.swapSyForYt(syIn, _slipped(amm.quoteSyForYt(syIn)));
        require(boughtYt > 0, "SY->YT failed");
        console2.log("SY->YT", boughtYt);

        // 9. Orderbook: resting ask, then fill it.
        uint64 orderId = book.placeOrder(Orderbook.Side.Ask, 5e18, 0.9e18, maturity - 60, 0);
        require(orderId > 0, "place failed");
        Orderbook.FillReceipt memory receipt = book.fillBest(Orderbook.Side.Ask, 5e18, 1e18);
        require(receipt.baseFilled == 5e18, "fill failed");

        // 10. The yield cashflow: issuer pays a coupon, which lifts the SY rate
        //     from 1.0 to 1.1. Observing it records the rate the maturity freeze
        //     will use, so YT is credited the coupon as yield.
        bond.distributeCoupon(100e18);
        uint256 observed = tokenizer.observeRate();
        console2.log("Observed SY rate", observed);
        require(observed > WAD, "coupon did not lift the rate");

        vm.stopBroadcast();

        // Persist the deployment for phase 2.
        string memory obj = "lifecycle";
        vm.serializeUint(obj, "maturity", maturity);
        vm.serializeAddress(obj, "cash", address(cash));
        vm.serializeAddress(obj, "bond", address(bond));
        vm.serializeAddress(obj, "sy", address(sy));
        vm.serializeAddress(obj, "strategy", address(strategy));
        vm.serializeAddress(obj, "pt", address(pt));
        vm.serializeAddress(obj, "yt", address(yt));
        vm.serializeAddress(obj, "tokenizer", address(tokenizer));
        vm.serializeAddress(obj, "amm", address(amm));
        string memory out = vm.serializeAddress(obj, "orderbook", address(book));
        vm.writeJson(out, "deployments/hedera-lifecycle.json");

        console2.log("cash", address(cash));
        console2.log("bond", address(bond));
        console2.log("sy", address(sy));
        console2.log("strategy", address(strategy));
        console2.log("pt", address(pt));
        console2.log("yt", address(yt));
        console2.log("tokenizer", address(tokenizer));
        console2.log("amm", address(amm));
        console2.log("orderbook", address(book));
        console2.log("PT held", pt.balanceOf(deployer));
        console2.log("YT held", yt.balanceOf(deployer));
        console2.log("SY held", sy.balanceOf(deployer));
        console2.log("cash held", cash.balanceOf(deployer));
        console2.log("=== PHASE 1 DONE, waiting for maturity ===");
    }
}
