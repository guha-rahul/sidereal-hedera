// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {AmmMarket} from "../src/AmmMarket.sol";

/// @title LifecyclePost
/// @notice Phase 2 of the full lifecycle, run after maturity: pulls AMM
///         liquidity, redeems PT for principal, claims YT yield, and redeems the
///         resulting SY back to cash. Reads the phase-1 deployment manifest.
contract LifecyclePost is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        string memory json = vm.readFile("deployments/hedera-lifecycle.json");
        address cash = vm.parseJsonAddress(json, ".cash");
        address syAddr = vm.parseJsonAddress(json, ".sy");
        address ptAddr = vm.parseJsonAddress(json, ".pt");
        address ytAddr = vm.parseJsonAddress(json, ".yt");
        address tokenizerAddr = vm.parseJsonAddress(json, ".tokenizer");
        address ammAddr = vm.parseJsonAddress(json, ".amm");
        uint256 maturity = vm.parseJsonUint(json, ".maturity");

        console2.log("=== PHASE 2: post-maturity ===");
        console2.log("Maturity", maturity);
        console2.log("Now", block.timestamp);
        require(block.timestamp >= maturity, "not matured yet");

        Tokenizer tokenizer = Tokenizer(tokenizerAddr);
        StandardizedYieldVault sy = StandardizedYieldVault(syAddr);
        PrincipalToken pt = PrincipalToken(ptAddr);
        YieldToken yt = YieldToken(ytAddr);
        AmmMarket amm = AmmMarket(ammAddr);

        uint256 cashBefore = IERC20(cash).balanceOf(deployer);
        console2.log("Cash before", cashBefore);
        console2.log("PT held", pt.balanceOf(deployer));
        console2.log("YT held", yt.balanceOf(deployer));
        console2.log("SY held", sy.balanceOf(deployer));

        vm.startBroadcast(pk);

        // 1. Pull the AMM position back out (removeLiquidity is not maturity
        //    gated, unlike swaps).
        uint256 lp = amm.lpBalance(deployer);
        if (lp > 0) {
            (uint256 ptBack, uint256 syBack) = amm.removeLiquidity(lp, 0, 0);
            console2.log("LP removed -> PT", ptBack);
            console2.log("LP removed -> SY", syBack);
        }

        // 2. Redeem all PT for principal. The first effective-rate read freezes
        //    the maturity rate observed in phase 1.
        uint256 ptBal = pt.balanceOf(deployer);
        if (ptBal > 0) {
            uint256 syFromPt = tokenizer.redeemAtMaturity(ptBal);
            console2.log("PT redeemed -> SY", syFromPt);
        }

        // 3. Claim the coupon yield on all YT.
        uint256 claimed = tokenizer.claimYield();
        console2.log("YT yield claimed -> SY", claimed);

        // 4. Redeem all SY to cash. The rate is stable post-maturity, so the
        //    full balance settles exactly.
        uint256 syBal = sy.balanceOf(deployer);
        if (syBal > 0) {
            uint256 cashOut = sy.redeem(syBal, 0);
            console2.log("SY redeemed -> cash", cashOut);
        }

        vm.stopBroadcast();

        uint256 cashAfter = IERC20(cash).balanceOf(deployer);
        console2.log("Cash after", cashAfter);
        console2.log("Frozen maturity rate", tokenizer.maturityRate());
        console2.log("Leftover escrow SY", tokenizer.escrowedSy());
        console2.log("=== PHASE 2 COMPLETE ===");
    }
}
