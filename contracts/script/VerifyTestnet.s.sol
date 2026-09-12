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

/// @title VerifyTestnet
/// @notice Deploys the full Sidereal market to a live Hedera network and
///         exercises the immediate lifecycle end to end in one broadcast:
///         deposit -> split -> seed AMM -> all four swap routes -> orderbook
///         place/fill -> SY redeem. Maturity-gated flows (claim/redeem) are
///         covered by the Foundry suite, which can warp time.
///
/// Usage:
///   PRIVATE_KEY=0x... forge script script/VerifyTestnet.s.sol:VerifyTestnet \
///     --rpc-url https://testnet.hashio.io/api --broadcast
contract VerifyTestnet is Script {
    uint256 internal constant WAD = 1e18;

    /// @dev 99% of `value`: a 1% slippage floor/ceiling. Live transactions land
    ///      at different timestamps and the bond accretes between them, so an
    ///      exact quote is not a safe on-chain bound.
    function _slipped(uint256 value) internal pure returns (uint256) {
        return (value * 99) / 100;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 now_ = block.timestamp;
        uint256 maturity = now_ + 90 days;

        console2.log("Deployer", deployer);
        console2.log("Chain", block.chainid);
        console2.log("Maturity", maturity);

        vm.startBroadcast(pk);

        // 1. Cash denomination and the tokenized bond (yield source).
        MockERC20 cash = new MockERC20("Hedera Test USD", "hUSD", 18);
        MockTokenizedBond bond = new MockTokenizedBond(address(cash), now_, maturity, 0.95e18, 1e18);
        cash.mint(deployer, 1_000_000e18);
        // Fund the bond's maturity cashflow so accretion can be paid out.
        cash.transfer(address(bond), 500_000e18);

        // 2. SY vault bound to the bond strategy.
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
        sy.approve(address(tokenizer), type(uint256).max);
        sy.approve(address(amm), type(uint256).max);
        pt.approve(address(amm), type(uint256).max);
        yt.approve(address(amm), type(uint256).max);
        pt.approve(address(book), type(uint256).max);
        sy.approve(address(book), type(uint256).max);

        // 6. Deposit and split.
        uint256 shares = sy.deposit(1_000e18, 0);
        console2.log("SY minted", shares);
        (uint256 ptOut, uint256 ytOut) = tokenizer.split(300e18);
        console2.log("PT/YT minted", ptOut);
        require(ptOut == ytOut && ptOut > 0, "split failed");

        // Split more so the pool can be seeded PT-heavy (the curve needs PT
        // proportion above 0.5 to price PT at a discount).
        tokenizer.split(300e18);

        // 7. Seed the AMM at 60/40 PT/SY.
        uint256 seedLp = amm.addLiquidity(
            (pt.balanceOf(deployer) * 6) / 10,
            (sy.balanceOf(deployer) * 4) / 10,
            0
        );
        require(seedLp > 0, "seed failed");
        console2.log("LP minted", seedLp);
        console2.log("Reserve PT", amm.reservePt());
        console2.log("Reserve SY", amm.reserveSy());

        // 8. All four swap routes. Min-out uses a 1% tolerance rather than the
        //    exact quote: each transaction lands at a different timestamp, and
        //    the bond accretes between them, so an exact-equality bound reverts.
        uint256 syIn = 20e18;
        uint256 quotedPt = amm.quoteSyForPt(syIn);
        uint256 boughtPt = amm.swapSyForPt(syIn, _slipped(quotedPt));
        require(boughtPt > 0, "SY->PT failed");
        console2.log("SY->PT", boughtPt);

        uint256 soldSy = amm.swapPtForSy(boughtPt / 2, 0);
        require(soldSy > 0, "PT->SY failed");
        console2.log("PT->SY", soldSy);

        uint256 quotedYt = amm.quoteSyForYt(syIn);
        uint256 boughtYt = amm.swapSyForYt(syIn, _slipped(quotedYt));
        require(boughtYt > 0, "SY->YT failed");
        console2.log("SY->YT", boughtYt);

        uint256 quotedSy = amm.quoteYtForSy(boughtYt / 2);
        uint256 soldSy2 = amm.swapYtForSy(boughtYt / 2, _slipped(quotedSy));
        require(soldSy2 > 0, "YT->SY failed");
        console2.log("YT->SY", soldSy2);

        // 9. Orderbook: place a resting ask and fill it.
        if (pt.balanceOf(deployer) > 5e18) {
            uint64 orderId = book.placeOrder(Orderbook.Side.Ask, 5e18, 0.9e18, now_ + 30 days, 0);
            require(orderId > 0, "place failed");
            Orderbook.FillReceipt memory receipt = book.fillBest(Orderbook.Side.Ask, 5e18, 1e18);
            require(receipt.baseFilled == 5e18, "fill failed");
            console2.log("Order filled base", receipt.baseFilled);
        }

        // 10. Redeem most of the remaining SY back to the underlying. Use a
        //     fraction, not the full balance: the balance read during script
        //     simulation can differ by a hair from the replay that estimates
        //     the broadcast, because each transaction lands at its own
        //     timestamp while the bond keeps accreting.
        uint256 held = (sy.balanceOf(deployer) * 95) / 100;
        if (held > 0) {
            uint256 out = sy.redeem(held, 0);
            require(out > 0, "SY redeem failed");
            console2.log("SY redeemed to cash", out);
        }

        vm.stopBroadcast();

        console2.log("cash", address(cash));
        console2.log("bond", address(bond));
        console2.log("sy", address(sy));
        console2.log("strategy", address(strategy));
        console2.log("pt", address(pt));
        console2.log("yt", address(yt));
        console2.log("tokenizer", address(tokenizer));
        console2.log("amm", address(amm));
        console2.log("orderbook", address(book));
        console2.log("implied APY bps", amm.impliedApy());
        console2.log("exchange rate", sy.exchangeRate());
    }
}
