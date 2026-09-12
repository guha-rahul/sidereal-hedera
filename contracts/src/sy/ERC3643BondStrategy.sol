// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldStrategy} from "../interfaces/IYieldStrategy.sol";
import {IBond3643} from "../interfaces/IBond3643.sol";
import {WadMath} from "../libraries/WadMath.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title ERC3643BondStrategy
/// @notice Sidereal yield source that holds an ERC-3643 tokenized bond whose
///         yield is the issuer's **cash coupon and principal cashflow**.
/// @dev The seam's anti-donation obligation is met by tracking `accountedBonds`
///      and `countedCash` explicitly: bonds or cash transferred to this address
///      by anyone else never enter the valuation. Coupons are pulled in by
///      `touch` (which claims every funded, executed coupon and counts the
///      measured cash delta), so the yield is realized as cash rather than
///      capitalized into a per-unit rate.
contract ERC3643BondStrategy is IYieldStrategy, ReentrancyGuard {
    using Checkpoints for Checkpoints.Trace208;
    using SafeCast for uint256;
    Checkpoints.Trace208 private _accountedHistory;
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    address public immutable vaultAddress;
    address public immutable bondToken;
    address public immutable underlyingToken;
    address public immutable securityToken;
    uint256 public immutable bondUnit;

    uint256 public accountedBonds;
    uint256 public countedCash;

    error NotVault();
    error InvalidAmount();
    error SlippageExceeded();
    error StrategyDeliveryFailed();

    event BondDeposited(uint256 cashIn, uint256 bondOut, uint256 assetsCredited);
    event BondWithdrawn(uint256 cashRequested, uint256 bondRedeemed, uint256 delivered);
    event CouponsClaimed(uint256 couponCount, uint256 cashClaimed);

    constructor(address vault_, address bond_) {
        if (vault_ == address(0) || bond_ == address(0)) revert InvalidAmount();
        vaultAddress = vault_;
        bondToken = bond_;
        underlyingToken = IBond3643(bond_).denomination();
        securityToken = IBond3643(bond_).securityToken();
        uint8 decimals_ = IERC20Metadata(securityToken).decimals();
        if (decimals_ > 18) revert InvalidAmount();
        bondUnit = 10 ** decimals_;
    }

    function underlying() external view returns (address) {
        return underlyingToken;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    /// @notice Bond principal value (accounted bonds marked at `valuePerUnit`)
    ///         plus claimed coupon cash.
    function totalAssets() public view returns (uint256) {
        IBond3643 bond = IBond3643(bondToken);
        uint256 assets = bond.valueOf(accountedBonds) + countedCash;
        uint256 count = bond.couponCount();
        for (uint256 i; i < count; i++) {
            assets += _attributedCoupon(i, bond.accruedCoupon(i, address(this)));
        }
        return assets;
    }

    /// @notice Cash the bond can presently pay, bounded by this position's value.
    function maxWithdraw() public view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 liquid = IBond3643(bondToken).availableLiquidity() + countedCash;
        return assets < liquid ? assets : liquid;
    }

    function deposit(address vault_, uint256 amount)
        external
        nonReentrant
        returns (uint256 credited)
    {
        if (msg.sender != vaultAddress || vault_ != vaultAddress) revert NotVault();
        if (amount == 0) revert InvalidAmount();

        uint256 beforeAssets = totalAssets();
        IERC20(underlyingToken).safeTransferFrom(vault_, address(this), amount);
        IERC20(underlyingToken).forceApprove(bondToken, amount);
        uint256 beforeBonds = IERC20(securityToken).balanceOf(address(this));
        uint256 bondOut = IBond3643(bondToken).purchase(amount);
        if (IERC20(securityToken).balanceOf(address(this)) - beforeBonds != bondOut) {
            revert StrategyDeliveryFailed();
        }
        IERC20(underlyingToken).forceApprove(bondToken, 0);
        accountedBonds += bondOut;
        _accountedHistory.push(block.timestamp.toUint48(), accountedBonds.toUint208());

        uint256 afterAssets = totalAssets();
        if (afterAssets <= beforeAssets) revert StrategyDeliveryFailed();
        credited = afterAssets - beforeAssets;
        emit BondDeposited(amount, bondOut, credited);
    }

    function withdraw(address vault_, uint256 amount, uint256 minUnderlyingOut)
        external
        nonReentrant
        returns (uint256 delivered)
    {
        if (msg.sender != vaultAddress || vault_ != vaultAddress) revert NotVault();
        if (amount == 0) revert InvalidAmount();

        uint256 assets = totalAssets();
        uint256 target = amount > assets ? assets : amount;
        uint256 cash = countedCash;
        uint256 fromCash = target <= cash ? target : cash;
        uint256 remaining = target - fromCash;

        uint256 bondsToBurn;
        if (remaining > 0) {
            uint256 vpu = IBond3643(bondToken).valuePerUnit();
            bondsToBurn = WadMath.mulDivUp(remaining, bondUnit, vpu);
            if (bondsToBurn > accountedBonds) bondsToBurn = accountedBonds;
        }

        uint256 cashOut;
        if (bondsToBurn > 0) {
            IERC20(securityToken).forceApprove(bondToken, bondsToBurn);
            uint256 cashBefore = IERC20(underlyingToken).balanceOf(address(this));
            cashOut = IBond3643(bondToken).redeem(bondsToBurn);
            IERC20(securityToken).forceApprove(bondToken, 0);
            if (IERC20(underlyingToken).balanceOf(address(this)) - cashBefore != cashOut) {
                revert StrategyDeliveryFailed();
            }
        }

        uint256 totalCash = fromCash + cashOut;
        delivered = totalCash > target ? target : totalCash;
        uint256 excess = totalCash - delivered;

        accountedBonds -= bondsToBurn;
        _accountedHistory.push(block.timestamp.toUint48(), accountedBonds.toUint208());
        countedCash = cash - fromCash + excess;
        if (delivered < minUnderlyingOut) revert SlippageExceeded();
        if (delivered == 0) revert StrategyDeliveryFailed();

        IERC20(underlyingToken).safeTransfer(vault_, delivered);
        emit BondWithdrawn(amount, bondsToBurn, delivered);
    }

    /// @notice Claims every funded, executed coupon, then accrues upstream. The
    ///         claimed cash is measured and added to `countedCash`, so the SY
    ///         exchange rate steps up on each coupon date.
    function touch() external nonReentrant {
        IBond3643 bond = IBond3643(bondToken);
        bond.accrue();

        uint256 before = IERC20(underlyingToken).balanceOf(address(this));
        uint256 count = bond.couponCount();
        uint256 claimed;
        uint256 attributed;
        for (uint256 i = 0; i < count; i++) {
            if (bond.claimableCoupon(i, address(this)) > 0) {
                attributed += _attributedCoupon(i, bond.claimableCoupon(i, address(this)));
                claimed += bond.claimCoupon(i);
            }
        }
        uint256 gained = IERC20(underlyingToken).balanceOf(address(this)) - before;
        if (gained != claimed || attributed > gained) revert StrategyDeliveryFailed();
        if (attributed > 0) countedCash += attributed;
        if (claimed > 0) emit CouponsClaimed(count, gained);
    }

    function maturity() external view returns (uint256) {
        return IBond3643(bondToken).maturityDate();
    }

    function _attributedCoupon(uint256 id, uint256 cash) internal view returns (uint256) {
        if (cash == 0) return 0;
        IBond3643 bond = IBond3643(bondToken);
        uint256 held = bond.couponBalance(id, address(this));
        if (held == 0) return 0;
        uint256 tracked = _accountedHistory.upperLookup(bond.couponInfo(id).recordDate.toUint48());
        if (tracked > held) tracked = held;
        return WadMath.mulDivDown(cash, tracked, held);
    }

    function isEligible(address account) external view returns (bool) {
        return IBond3643(bondToken).isVerified(account);
    }

    function settlementReady() external view returns (bool) {
        return IBond3643(bondToken).isMatured();
    }
}
