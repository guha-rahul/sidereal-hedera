// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {AmmMarket} from "../src/AmmMarket.sol";
import {Orderbook} from "../src/Orderbook.sol";
import {IATSAdmin} from "./ats/IATSFactory.sol";

/// @notice Separate runs around real chain time; no live vm.warp or fabricated receipts.
contract ATSLifecycle is Script {
    function run() external {
        require(block.chainid == 296, "testnet only");
        runPhase(
            vm.envString("PHASE"),
            vm.envUint("PRIVATE_KEY"),
            vm.envOr("MANIFEST_PATH", string("deployments/hedera-ats.json"))
        );
    }

    /// @dev The phase body is a parameterised entry point so fork tests can drive
    ///      each phase directly. Selecting phases through environment variables is
    ///      unsafe under parallel test execution, because `setEnv` is process-wide.
    function runPhase(string memory phase, uint256 key, string memory manifestPath) public {
        string memory json = vm.readFile(manifestPath);
        address issuer = vm.parseJsonAddress(json,".issuer");
        address buyer = vm.parseJsonAddress(json,".buyer");
        address cash = vm.parseJsonAddress(json,".cash");
        address pt = vm.parseJsonAddress(json,".pt");
        address syAddress = vm.parseJsonAddress(json,".sy");
        StandardizedYieldVault sy = StandardizedYieldVault(syAddress);
        Tokenizer tokenizer = Tokenizer(vm.parseJsonAddress(json,".tokenizer"));
        AmmMarket amm = AmmMarket(vm.parseJsonAddress(json,".amm"));
        Orderbook book = Orderbook(vm.parseJsonAddress(json,".orderbook"));
        address actor = vm.addr(key);
        uint256 beforeCash = IERC20(cash).balanceOf(actor);
        vm.startBroadcast(key);
        if (keccak256(bytes(phase)) == keccak256("seed")) {
            require(actor == issuer, "issuer key required");
            require(block.timestamp < vm.parseJsonUint(json,".recordDate"), "record date passed");
            IERC20(cash).approve(syAddress, 4_000e6);
            sy.deposit(4_000e6, 0);
            IERC20(syAddress).approve(address(tokenizer),2_000e18);
            tokenizer.split(2_000e18);
            IERC20(pt).approve(address(amm),1_000e18);
            IERC20(syAddress).approve(address(amm),1_000e18);
            amm.addLiquidity(1_000e18,1_000e18,0);
            IERC20(pt).approve(address(book),100e18);
            book.placeOrder(Orderbook.Side.Ask,100e18,0.98e18,vm.parseJsonUint(json,".maturity"),0);
        } else if (keccak256(bytes(phase)) == keccak256("trade")) {
            require(actor == buyer, "buyer key required");
            IERC20(cash).approve(syAddress,1_000e6);
            sy.deposit(1_000e6,0);
            IERC20(syAddress).approve(address(book),100e18);
            book.fillBest(Orderbook.Side.Ask,100e18,0.98e18);
            IERC20(syAddress).approve(address(amm),10e18);
            amm.swapSyForPt(10e18,1);
        } else if (keccak256(bytes(phase)) == keccak256("coupon")) {
            require(block.timestamp >= vm.parseJsonUint(json,".executionDate"), "coupon not due");
            sy.touch();
        } else if (keccak256(bytes(phase)) == keccak256("revoke")) {
            require(actor == issuer, "issuer key required");
            IATSAdmin(vm.parseJsonAddress(json,".security")).revokeKyc(buyer);
        } else if (keccak256(bytes(phase)) == keccak256("reinstate")) {
            require(actor == issuer, "issuer key required");
            IATSAdmin(vm.parseJsonAddress(json,".security")).grantKyc(buyer,"testnet-demo-eligibility",0,
                vm.parseJsonUint(json,".maturity")+365 days,issuer);
        } else if (keccak256(bytes(phase)) == keccak256("settle")) {
            require(block.timestamp >= vm.parseJsonUint(json,".maturity"), "market not matured");
            if (actor == issuer) {
                uint256 lp = amm.lpBalance(actor);
                if (lp > 0) amm.removeLiquidity(lp,0,0);
            }
            uint256 face = IERC20(pt).balanceOf(actor);
            if (face > 0) tokenizer.redeemAtMaturity(face);
            tokenizer.claimYield();
            uint256 shares = IERC20(syAddress).balanceOf(actor);
            if (shares > 0) sy.redeem(shares,0);
        } else { revert("unknown PHASE"); }
        vm.stopBroadcast();
        console2.log("actor",actor);
        console2.log("cash before",beforeCash);
        console2.log("cash after",IERC20(cash).balanceOf(actor));
        console2.log("PT after",IERC20(pt).balanceOf(actor));
        console2.log("SY after",IERC20(syAddress).balanceOf(actor));
    }
}
