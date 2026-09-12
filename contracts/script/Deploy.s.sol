// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {ERC3643BondStrategy} from "../src/sy/ERC3643BondStrategy.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {Orderbook} from "../src/Orderbook.sol";

/// @title Deploy
/// @notice Deploys the Sidereal market around an **existing** ERC-3643 tokenized
///         bond. Nothing mock-like is deployed: the cash denomination and the
///         bond (with its identity registry and compliance already wired) must
///         exist on-chain before this runs.
///
/// Environment:
///   PRIVATE_KEY     - deployer key (or use forge --private-key)
///   CASH_ASSET      - required: the bond's denomination ERC-20
///   BOND            - required: deployed ERC-3643 bond address
///   ADMIN           - protocol admin (defaults to the deployer)
///   FEE_RECIPIENT   - protocol fee recipient (defaults to ADMIN)
///   MATURITY        - unix seconds; defaults to now + 90 days
///   SCALAR_ROOT     - AMM curve scalar (default 1e18)
///   ANCHOR          - AMM initial anchor (default 1e18)
///   FEE_BPS         - AMM swap fee in bps (default 10)
///   TAKER_FEE_BPS   - orderbook taker fee in bps (default 10)
///   TWAP_WINDOW     - AMM TWAP window seconds (default 1800)
///   BOND_FUNDING    - cash seeded into the bond's redemption reserve (default 0)
contract Deploy is Script {
    function run()
        external
        returns (
            address cash,
            address bond,
            address sy,
            address strategy,
            address pt,
            address yt,
            address tokenizer,
            address amm,
            address orderbook
        )
    {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = pk == 0 ? msg.sender : vm.addr(pk);
        address admin = vm.envOr("ADMIN", deployer);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", admin);
        uint256 maturity = vm.envOr("MATURITY", block.timestamp + 90 days);
        uint256 scalarRoot = vm.envOr("SCALAR_ROOT", uint256(1e18));
        uint256 anchor = vm.envOr("ANCHOR", uint256(1e18));
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(10));
        uint256 takerFeeBps = vm.envOr("TAKER_FEE_BPS", uint256(10));
        uint256 twapWindow = vm.envOr("TWAP_WINDOW", uint256(30 minutes));
        uint256 bondFunding = vm.envOr("BOND_FUNDING", uint256(0));

        // Real assets only: fail loudly rather than deploy a stand-in.
        cash = vm.envAddress("CASH_ASSET");
        bond = vm.envAddress("BOND");

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();

        if (bondFunding > 0) {
            // Top up the bond's redemption reserve before the market opens.
            IERC20(cash).transferFrom(deployer, bond, bondFunding);
        }

        // 1. SY vault bound to the ERC-3643 bond strategy.
        sy = address(new StandardizedYieldVault());
        strategy = address(new ERC3643BondStrategy(sy, bond));
        StandardizedYieldVault(sy).initialize(admin, strategy);

        // 2. PT + YT + tokenizer.
        pt = address(new PrincipalToken());
        yt = address(new YieldToken());
        tokenizer = address(new Tokenizer());
        Tokenizer(tokenizer).initialize(admin, sy, pt, yt, maturity, feeRecipient, 0);
        PrincipalToken(pt).initialize(admin, tokenizer, sy, maturity);
        YieldToken(yt).initialize(admin, tokenizer, sy, maturity);

        // 3. AMM + orderbook beside it.
        amm = address(new AmmMarket());
        AmmMarket(amm).initialize(
            admin, pt, sy, yt, tokenizer, maturity, scalarRoot, anchor, feeBps, twapWindow
        );
        orderbook = address(new Orderbook());
        Orderbook(orderbook).initialize(admin, pt, sy, maturity, feeRecipient, takerFeeBps);

        vm.stopBroadcast();

        console2.log("cash", cash);
        console2.log("bond", bond);
        console2.log("sy", sy);
        console2.log("strategy", strategy);
        console2.log("pt", pt);
        console2.log("yt", yt);
        console2.log("tokenizer", tokenizer);
        console2.log("amm", amm);
        console2.log("orderbook", orderbook);
    }
}
