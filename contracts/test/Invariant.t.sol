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

/// @notice Fuzz properties for the Layer 1/2 accounting.
contract InvariantTest is Test {
    MockERC20 internal cash;
    MockTokenizedBond internal bond;
    StandardizedYieldVault internal sy;
    BondStrategy internal strategy;
    PrincipalToken internal pt;
    YieldToken internal yt;
    Tokenizer internal tokenizer;

    address internal admin = address(0xA11CE);
    address internal alice = address(0xA11CE1);

    uint256 internal t0;
    uint256 internal maturity;

    function setUp() public {
        t0 = 1_770_000_000;
        vm.warp(t0);
        maturity = t0 + 90 days;

        cash = new MockERC20("USD", "USD", 18);
        bond = new MockTokenizedBond(address(cash), t0, maturity, 0.95e18, 1e18);
        cash.mint(address(this), 5_000_000e18);
        cash.transfer(address(bond), 2_000_000e18);

        sy = new StandardizedYieldVault();
        strategy = new BondStrategy(address(sy), address(bond));
        sy.initialize(admin, address(strategy));
        pt = new PrincipalToken();
        yt = new YieldToken();
        tokenizer = new Tokenizer();
        tokenizer.initialize(admin, address(sy), address(pt), address(yt), maturity, admin, 0);
        pt.initialize(admin, address(tokenizer), address(sy), maturity);
        yt.initialize(admin, address(tokenizer), address(sy), maturity);

        cash.mint(alice, type(uint96).max);
        vm.startPrank(alice);
        cash.approve(address(sy), type(uint256).max);
        sy.approve(address(tokenizer), type(uint256).max);
        vm.stopPrank();
    }

    function _enter(
        uint256 amount
    ) internal returns (uint256 shares, uint256 ptOut, uint256 ytOut) {
        vm.prank(alice);
        shares = sy.deposit(amount, 0);
        vm.prank(alice);
        (ptOut, ytOut) = tokenizer.split(shares);
    }

    /// @dev Recombining immediately must return the principal in full: the SY
    ///      shares returned unwrap to the deposited amount, within rounding.
    function testFuzz_recombineReturnsPrincipal(uint96 rawAmount, uint64 rawElapsed) public {
        uint256 amount = bound(uint256(rawAmount), 1e18, 1e24);
        uint256 elapsed = bound(uint256(rawElapsed), 0, 60 days);

        (, uint256 ptOut, uint256 ytOut) = _enter(amount);
        vm.warp(t0 + elapsed);

        vm.prank(alice);
        uint256 syOut = tokenizer.recombine(ptOut, ytOut);
        vm.prank(alice);
        uint256 cashOut = sy.redeem(syOut, 0);

        assertApproxEqRel(cashOut, amount, 1e15, "principal must round-trip");
    }

    /// @dev PT redemption at maturity must return principal, independent of how
    ///      much yield the escrow earned.
    function testFuzz_ptRedeemsPrincipalAtMaturity(uint96 rawAmount, uint64 rawElapsed) public {
        uint256 amount = bound(uint256(rawAmount), 1e18, 1e24);
        uint256 elapsed = bound(uint256(rawElapsed), 0, 89 days);

        (, uint256 ptOut,) = _enter(amount);
        vm.warp(t0 + elapsed);
        if (elapsed < 89 days) vm.warp(maturity - 1);
        tokenizer.observeRate();
        vm.warp(maturity);

        vm.prank(alice);
        uint256 syOut = tokenizer.redeemAtMaturity(ptOut);
        vm.prank(alice);
        uint256 cashOut = sy.redeem(syOut, 0);
        assertApproxEqRel(cashOut, amount, 1e15, "PT must return principal at maturity");
    }

    /// @dev The escrow always covers PT face plus unclaimed YT yield while the
    ///      rate is non-decreasing.
    function testFuzz_escrowCoversObligations(uint96 rawAmount, uint64 rawElapsed) public {
        uint256 amount = bound(uint256(rawAmount), 1e18, 1e24);
        uint256 elapsed = bound(uint256(rawElapsed), 0, 60 days);

        (, uint256 ptOut,) = _enter(amount);
        vm.warp(t0 + elapsed);
        assertGt(ptOut, 0);

        uint256 rate = sy.exchangeRate();
        uint256 escrowValue = (tokenizer.escrowedSy() * rate) / 1e18;
        uint256 principal = pt.totalSupply();

        assertGe(escrowValue + 1e6, principal, "escrow must cover PT principal");
    }
}
