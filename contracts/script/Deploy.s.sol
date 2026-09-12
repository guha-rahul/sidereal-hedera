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

/// @title Deploy
/// @notice Deploys the full Sidereal market to Hedera (EVM).
///
/// Environment:
///   PRIVATE_KEY      - deployer key (or use forge --private-key)
///   ADMIN            - protocol admin (defaults to the deployer)
///   CASH_ASSET       - bond denomination ERC-20 (defaults to a new MockERC20)
///   BOND             - existing ERC-3643/ATS bond (defaults to a MockTokenizedBond)
///   FEE_RECIPIENT    - protocol fee recipient (defaults to ADMIN)
///   MATURITY         - unix seconds; defaults to now + 90 days
///   SCALAR_ROOT      - AMM curve scalar (default 1e18)
///   ANCHOR           - AMM initial anchor (default 1e18)
///   FEE_BPS          - AMM swap fee in bps (default 10)
///   TAKER_FEE_BPS    - orderbook taker fee in bps (default 10)
///   TWAP_WINDOW      - AMM TWAP window seconds (default 1800)
///   BOND_FUNDING     - cash seeded into the bond for accretion (default 0)
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

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();

        // 1. Cash denomination.
        cash = vm.envOr("CASH_ASSET", address(0));
        if (cash == address(0)) {
            cash = address(new MockERC20("Hedera Test USD", "hUSD", 18));
        }

        // 2. Bond (yield source). A mock stands in for a live ATS bond.
        bond = vm.envOr("BOND", address(0));
        if (bond == address(0)) {
            bond = address(
                new MockTokenizedBond(cash, block.timestamp, maturity, 0.95e18, 1e18)
            );
        }
        if (bondFunding > 0) {
            // Fund the bond so its maturity cashflow can pay the accreted yield.
            IERC20(cash).transferFrom(deployer, bond, bondFunding);
        }

        // 3. SY vault bound to the bond strategy.
        sy = address(new StandardizedYieldVault());
        strategy = address(new BondStrategy(sy, bond));
        StandardizedYieldVault(sy).initialize(admin, strategy);

        // 4. PT + YT + tokenizer.
        pt = address(new PrincipalToken());
        yt = address(new YieldToken());
        tokenizer = address(new Tokenizer());
        Tokenizer(tokenizer).initialize(
            admin, sy, pt, yt, maturity, feeRecipient, 0
        );
        PrincipalToken(pt).initialize(admin, tokenizer, sy, maturity);
        YieldToken(yt).initialize(admin, tokenizer, sy, maturity);

        // 5. AMM + orderbook beside it.
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
