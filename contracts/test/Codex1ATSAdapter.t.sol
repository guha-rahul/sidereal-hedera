// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IATSBond} from "../src/interfaces/IATSBond.sol";
import {ATSBondAdapter} from "../src/sy/ATSBondAdapter.sol";
import {ERC3643BondStrategy} from "../src/sy/ERC3643BondStrategy.sol";
import {StandardizedYieldVault} from "../src/sy/StandardizedYieldVault.sol";
import {Tokenizer} from "../src/Tokenizer.sol";
import {PrincipalToken} from "../src/tokens/PrincipalToken.sol";
import {YieldToken} from "../src/tokens/YieldToken.sol";
import {TestERC20} from "./mocks/TestERC20.sol";

/// @dev Test double for the pinned external ABI. The separate live-read test
///      verifies ABI decoding against a real factory-issued ATS asset.
contract ATSFixtureToken is ERC20 {
    IATSBond.BondDetailsData private _terms;
    IATSBond.Coupon private _coupon;
    mapping(address => bool) public verified;
    mapping(address => bool) public blocked;
    mapping(address => uint256) public atRecord;
    mapping(address => bool) private _recorded;
    bool public paused;
    uint256 public snapshotId;

    constructor() ERC20("ATS ABI test double", "TEST") {
        _terms = IATSBond.BondDetailsData("USD", 100, 2, block.timestamp, block.timestamp + 10 days);
        _coupon = IATSBond.Coupon(
            block.timestamp + 1 days,
            block.timestamp + 2 days,
            block.timestamp,
            block.timestamp + 2 days,
            block.timestamp,
            10,
            2,
            1
        );
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setVerified(address who, bool value) external {
        verified[who] = value;
    }

    function setBlocked(address who, bool value) external {
        blocked[who] = value;
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function getBondDetails() external view returns (IATSBond.BondDetailsData memory) {
        return _terms;
    }

    function getCouponCount() external pure returns (uint256) {
        return 1;
    }

    function getCoupon(uint256 id) external view returns (IATSBond.RegisteredCoupon memory) {
        require(id == 1);
        return IATSBond.RegisteredCoupon(_coupon, snapshotId);
    }

    function getCouponFor(uint256 id, address holder)
        external
        view
        returns (IATSBond.CouponFor memory)
    {
        require(id == 1);
        return
            IATSBond.CouponFor(_balanceAt(holder), 6, block.timestamp > _coupon.recordDate, _coupon);
    }

    function getCouponAmountFor(uint256 id, address holder)
        external
        view
        returns (IATSBond.CouponAmountFor memory)
    {
        require(id == 1);
        // A deterministic 10% entitlement in whole currency units for accounting tests.
        return
            IATSBond.CouponAmountFor(_balanceAt(holder), 10e6, block.timestamp > _coupon.recordDate);
    }

    function getKycStatusFor(address who) external view returns (uint8) {
        return verified[who] ? 1 : 0;
    }

    function getControlListType() external pure returns (bool) {
        return false;
    }

    function isInControlList(address who) external view returns (bool) {
        return blocked[who];
    }

    function isPaused() external view returns (bool) {
        return paused;
    }

    function isAddressRecovered(address) external pure returns (bool) {
        return false;
    }

    function getFrozenTokens(address) external pure returns (uint256) {
        return 0;
    }

    function triggerAndSyncAll(bytes32, address from, address to) external {
        _snapshot(from);
        _snapshot(to);
    }

    function mutateMaturity() external {
        _terms.maturityDate += 1;
    }

    function _balanceAt(address holder) internal view returns (uint256) {
        return _recorded[holder] ? atRecord[holder] : balanceOf(holder);
    }

    function _snapshot(address holder) internal {
        if (block.timestamp <= _coupon.recordDate || _recorded[holder]) return;
        snapshotId = 1;
        atRecord[holder] = balanceOf(holder);
        _recorded[holder] = true;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(!paused);
        if (from != address(0)) require(verified[from] && !blocked[from]);
        _snapshot(from);
        if (to != address(0)) require(verified[to] && !blocked[to]);
        _snapshot(to);
        super._update(from, to, amount);
    }
}

contract Codex1ATSAdapterTest is Test {
    ATSFixtureToken security;
    TestERC20 cash;
    ATSBondAdapter adapter;
    StandardizedYieldVault sy;
    ERC3643BondStrategy strategy;
    Tokenizer tokenizer;
    PrincipalToken pt;
    YieldToken yt;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 start;

    function setUp() public {
        start = 1_789_000_000;
        vm.warp(start);
        security = new ATSFixtureToken();
        cash = new TestERC20("Test USD", "USD", 6);
        adapter = new ATSBondAdapter(address(security), address(cash), address(this), 950_000);
        sy = new StandardizedYieldVault();
        strategy = new ERC3643BondStrategy(address(sy), address(adapter));
        sy.initialize(address(this), address(strategy));
        adapter.bindStrategy(address(strategy));
        tokenizer = new Tokenizer();
        pt = new PrincipalToken();
        yt = new YieldToken();
        tokenizer.initialize(
            address(this), address(sy), address(pt), address(yt), start + 10 days, address(this), 0
        );
        pt.initialize(address(this), address(tokenizer), address(sy), start + 10 days);
        yt.initialize(address(this), address(tokenizer), address(sy), start + 10 days);
        security.setVerified(address(adapter), true);
        security.setVerified(address(strategy), true);
        security.setVerified(address(tokenizer), true);
        security.setVerified(address(this), true);
        security.setVerified(alice, true);
        security.setVerified(bob, true);
        security.mint(address(adapter), 10_000e6);
        cash.mint(address(this), 20_000e6);
        cash.approve(address(adapter), type(uint256).max);
        adapter.fundPrincipal(1_000e6);
        adapter.fundCoupon(0, 1_000e6);
        cash.mint(alice, 950e6);
        cash.mint(bob, 950e6);
    }

    function _deposit(address who) internal returns (uint256 shares) {
        vm.startPrank(who);
        cash.approve(address(sy), type(uint256).max);
        shares = sy.deposit(950e6, 0);
        sy.approve(address(tokenizer), type(uint256).max);
        vm.stopPrank();
    }

    function testSixDecimalCashAndATSInventoryRoundTrip() public {
        uint256 shares = _deposit(alice);
        assertApproxEqAbs(shares, 950e18, 1e14);
        assertEq(strategy.accountedBonds(), 1_000e6);
        assertEq(security.balanceOf(address(strategy)), 1_000e6);
        vm.prank(alice);
        assertApproxEqAbs(sy.redeem(shares, 0), shares / 1e12, 2);
    }

    function testCouponReceivablePreventsDilutionBeforePayment() public {
        _deposit(alice);
        vm.warp(start + 1 days + 1);
        uint256 beforeAssets = strategy.totalAssets();
        uint256 shares = _deposit(bob);
        assertApproxEqAbs(strategy.totalAssets() - beforeAssets, 950e6, 2);
        vm.warp(start + 2 days);
        uint256 rateBefore = sy.exchangeRate();
        strategy.touch();
        assertEq(sy.exchangeRate(), rateBefore);
        assertEq(strategy.countedCash(), 100e6);
        assertEq(adapter.couponReserve(0), 900e6);
        assertGt(shares, 0);
    }

    function testMaturitySettlesPTAndCashCouponWithoutKeeper() public {
        uint256 shares = _deposit(alice);
        vm.prank(alice);
        tokenizer.split(shares);
        vm.warp(start + 10 days);
        uint256 face = pt.balanceOf(alice);
        vm.prank(alice);
        uint256 redeemed = tokenizer.redeemAtMaturity(face);
        vm.prank(alice);
        assertApproxEqAbs(sy.redeem(redeemed, 0), face / 1e12, 2);
        vm.prank(alice);
        uint256 yieldShares = tokenizer.claimYield();
        uint256 expectedYield = (150e6 * shares) / (shares + sy.MINIMUM_SHARES());
        vm.prank(alice);
        assertApproxEqAbs(sy.redeem(yieldShares, 0), expectedYield, 3);
    }

    function testRevocationAndPauseBlockClaims() public {
        uint256 shares = _deposit(alice);
        security.setBlocked(alice, true);
        vm.prank(alice);
        vm.expectRevert();
        sy.redeem(shares, 0);
        security.setBlocked(alice, false);
        security.setPaused(true);
        vm.prank(alice);
        vm.expectRevert();
        sy.transfer(bob, 1);
    }

    function testTermsMutationFailsClosed() public {
        _deposit(alice);
        security.mutateMaturity();
        vm.expectRevert(ATSBondAdapter.UnsupportedTerms.selector);
        strategy.totalAssets();
    }

    function testDirectCallerCannotBuyOrClaimForStrategy() public {
        vm.prank(alice);
        vm.expectRevert(ATSBondAdapter.NotStrategy.selector);
        adapter.purchase(1e6);
        vm.prank(alice);
        vm.expectRevert(ATSBondAdapter.NotStrategy.selector);
        adapter.claimCoupon(0);
    }

    function testDonatedBondsDoNotIncreaseCouponNAV() public {
        _deposit(alice);
        security.setVerified(bob, true);
        security.mint(bob, 1_000e6);
        vm.prank(bob);
        security.transfer(address(strategy), 1_000e6);
        vm.warp(start + 2 days);
        assertEq(adapter.accruedCoupon(0, address(strategy)), 200e6);
        uint256 beforeAssets = strategy.totalAssets();
        strategy.touch();
        assertEq(strategy.countedCash(), 100e6);
        assertEq(strategy.totalAssets(), beforeAssets);
    }
}
