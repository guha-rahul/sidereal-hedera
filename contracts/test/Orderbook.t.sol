// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockTokenizedBond} from "../src/sy/MockTokenizedBond.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {BondStrategy} from "../src/sy/BondStrategy.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {Orderbook} from "../src/Orderbook.sol";

contract OrderbookTest is Test {
    uint256 internal constant WAD = 1e18;

    MockERC20 internal cash;
    MockTokenizedBond internal bond;
    StandardizedYieldVault internal sy;
    BondStrategy internal strategy;
    PrincipalToken internal pt;
    YieldToken internal yt;
    Tokenizer internal tokenizer;
    Orderbook internal book;

    address internal admin = address(0xA11CE);
    address internal alice = address(0xA11CE1);
    address internal bob = address(0xB0B);
    address internal feeRecipient = address(0xFEE);

    uint256 internal t0;
    uint256 internal maturity;

    function setUp() public {
        t0 = 1_770_000_000;
        vm.warp(t0);
        maturity = t0 + 90 days;

        cash = new MockERC20("USD", "USD", 18);
        bond = new MockTokenizedBond(address(cash), t0, maturity, 0.95e18, 1e18);
        cash.mint(address(this), 2_000_000e18);
        cash.transfer(address(bond), 1_000_000e18);

        sy = new StandardizedYieldVault();
        strategy = new BondStrategy(address(sy), address(bond));
        sy.initialize(admin, address(strategy));
        pt = new PrincipalToken();
        yt = new YieldToken();
        tokenizer = new Tokenizer();
        tokenizer.initialize(admin, address(sy), address(pt), address(yt), maturity, feeRecipient, 0);
        pt.initialize(admin, address(tokenizer), address(sy), maturity);
        yt.initialize(admin, address(tokenizer), address(sy), maturity);

        book = new Orderbook();
        book.initialize(admin, address(pt), address(sy), maturity, feeRecipient, 10);

        cash.mint(alice, 100_000e18);
        cash.mint(bob, 100_000e18);
        vm.startPrank(alice);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(tokenizer), type(uint256).max);
        sy.deposit(10_000e18, 0);
        tokenizer.split(5_000e18);
        pt.approve(address(book), type(uint256).max);
        sy.approve(address(book), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(tokenizer), type(uint256).max);
        pt.approve(address(book), type(uint256).max);
        sy.approve(address(book), type(uint256).max);
        sy.deposit(10_000e18, 0);
        vm.stopPrank();
    }

    function testAskPlaceAndFill() public {
        uint256 expiry = t0 + 30 days;
        vm.prank(alice);
        uint64 id = book.placeOrder(Orderbook.Side.Ask, 100e18, 0.98e18, expiry, 0);
        assertEq(book.openCount(), 1);
        assertEq(book.askHead(), id);

        uint256 aliceSyBefore = sy.balanceOf(alice);
        uint256 bobPtBefore = pt.balanceOf(bob);

        vm.prank(bob);
        Orderbook.FillReceipt memory r = book.fillBest(Orderbook.Side.Ask, 100e18, 0.99e18);
        assertEq(r.baseFilled, 100e18);
        assertEq(r.quoteAmount, 98e18);
        assertEq(r.takerFee, 0.098e18);
        assertEq(pt.balanceOf(bob), bobPtBefore + 100e18);
        assertEq(sy.balanceOf(alice), aliceSyBefore + 98e18);
        assertEq(book.openCount(), 0);
    }

    function testBidPlaceAndFill() public {
        uint256 expiry = t0 + 30 days;
        // Fund bob with PT so he can hit the bid.
        vm.prank(bob);
        tokenizer.split(2_000e18);

        vm.prank(alice);
        book.placeOrder(Orderbook.Side.Bid, 100e18, 0.97e18, expiry, 0);
        assertEq(book.openCount(), 1);

        uint256 aliceSyBefore = sy.balanceOf(alice);
        uint256 bobPtAfterSplit = pt.balanceOf(bob);
        uint256 alicePtBefore = pt.balanceOf(alice);

        vm.prank(bob);
        Orderbook.FillReceipt memory r = book.fillBest(Orderbook.Side.Bid, 100e18, 0.96e18);
        assertEq(r.baseFilled, 100e18);
        assertEq(r.quoteAmount, 97e18);
        assertEq(r.takerFee, 0.097e18);
        assertEq(pt.balanceOf(bob), bobPtAfterSplit - 100e18);
        // Alice (maker) receives the PT; bob receives quote minus fee.
        assertEq(pt.balanceOf(alice), alicePtBefore + 100e18);
        assertEq(sy.balanceOf(alice), aliceSyBefore);
        assertEq(book.openCount(), 0);
    }

    function testCancelRefundsEscrow() public {
        uint256 expiry = t0 + 30 days;
        uint256 ptBefore = pt.balanceOf(alice);
        vm.prank(alice);
        uint64 id = book.placeOrder(Orderbook.Side.Ask, 100e18, 0.98e18, expiry, 0);
        assertEq(pt.balanceOf(alice), ptBefore - 100e18);

        vm.prank(alice);
        book.cancelOrder(id);
        assertEq(pt.balanceOf(alice), ptBefore);
        assertEq(book.openCount(), 0);
    }

    function testCrossingOrderIsRejected() public {
        uint256 expiry = t0 + 30 days;
        vm.prank(alice);
        book.placeOrder(Orderbook.Side.Ask, 100e18, 0.98e18, expiry, 0);

        // A bid at or above the ask would cross and must be rejected.
        vm.prank(bob);
        vm.expectRevert(Orderbook.OrderWouldCross.selector);
        book.placeOrder(Orderbook.Side.Bid, 100e18, 0.98e18, expiry, 0);
    }

    function testPriceTimePriority() public {
        uint256 expiry = t0 + 30 days;
        vm.startPrank(alice);
        uint64 first = book.placeOrder(Orderbook.Side.Ask, 50e18, 0.98e18, expiry, 0);
        uint64 second = book.placeOrder(Orderbook.Side.Ask, 50e18, 0.99e18, expiry, first);
        // Equal price must sit behind an existing order at that price.
        uint64 third = book.placeOrder(Orderbook.Side.Ask, 50e18, 0.99e18, expiry, second);
        vm.stopPrank();

        assertEq(book.askHead(), first);
        Orderbook.Order memory best = book.bestOrder(Orderbook.Side.Ask);
        assertEq(best.id, first);
        assertEq(third, 3);
    }

    function testExpiredOrderCannotBeFilledButCanBePruned() public {
        uint256 expiry = t0 + 1 days;
        vm.prank(alice);
        book.placeOrder(Orderbook.Side.Ask, 100e18, 0.98e18, expiry, 0);
        vm.warp(expiry + 1);

        vm.prank(bob);
        vm.expectRevert(Orderbook.OrderExpired.selector);
        book.fillBest(Orderbook.Side.Ask, 100e18, 1e18);

        uint32 pruned = book.pruneExpired(Orderbook.Side.Ask, 10);
        assertEq(pruned, 1);
        assertEq(book.openCount(), 0);
    }
}
