// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldStrategy} from "../interfaces/IYieldStrategy.sol";
import {IBond3643} from "../interfaces/IBond3643.sol";
import {WadMath} from "../libraries/WadMath.sol";

/// @title ERC3643BondStrategy
/// @notice Sidereal yield source that holds an ERC-3643 tokenized bond whose
///         yield is the issuer's **cash coupon and principal cashflow**.
/// @dev The seam's anti-donation obligation is met by tracking `accountedBonds`
///      and `countedCash` explicitly: bonds or cash transferred to this address
///      by anyone else never enter the valuation. Coupons are pulled in by
///      `touch` (which claims every funded, executed coupon and counts the
///      measured cash delta), so the yield is realized as cash rather than
///      capitalized into a per-unit rate.
contract ERC3643BondStrategy is IYieldStrategy {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    address public immutable vaultAddress;
    address public immutable bondToken;
    address public immutable underlyingToken;

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
        return IBond3643(bondToken).valueOf(accountedBonds) + countedCash;
    }

    /// @notice Cash the bond can presently pay, bounded by this position's value.
    function maxWithdraw() public view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 liquid = IBond3643(bondToken).availableLiquidity() + countedCash;
        return assets < liquid ? assets : liquid;
    }

    function deposit(address vault_, uint256 amount) external returns (uint256 credited) {
        if (msg.sender != vaultAddress || vault_ != vaultAddress) revert NotVault();
        if (amount == 0) revert InvalidAmount();

        uint256 beforeAssets = totalAssets();
        IERC20(underlyingToken).safeTransferFrom(vault_, address(this), amount);
        IERC20(underlyingToken).forceApprove(bondToken, amount);
        uint256 bondOut = IBond3643(bondToken).purchase(amount);
        IERC20(underlyingToken).forceApprove(bondToken, 0);
        accountedBonds += bondOut;

        uint256 afterAssets = totalAssets();
        if (afterAssets <= beforeAssets) revert StrategyDeliveryFailed();
        credited = afterAssets - beforeAssets;
        emit BondDeposited(amount, bondOut, credited);
    }

    function withdraw(
        address vault_,
        uint256 amount,
        uint256 minUnderlyingOut
    ) external returns (uint256 delivered) {
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
            bondsToBurn = WadMath.mulDivUp(remaining, WadMath.WAD, vpu);
            if (bondsToBurn > accountedBonds) bondsToBurn = accountedBonds;
        }

        uint256 cashOut;
        if (bondsToBurn > 0) {
            cashOut = IBond3643(bondToken).redeem(bondsToBurn);
        }

        uint256 totalCash = fromCash + cashOut;
        delivered = totalCash > target ? target : totalCash;
        uint256 excess = totalCash - delivered;

        accountedBonds -= bondsToBurn;
        countedCash = cash - fromCash + excess;
        if (delivered < minUnderlyingOut) revert SlippageExceeded();
        if (delivered == 0) revert StrategyDeliveryFailed();

        IERC20(underlyingToken).safeTransfer(vault_, delivered);
        emit BondWithdrawn(amount, bondsToBurn, delivered);
    }

    /// @notice Claims every funded, executed coupon, then accrues upstream. The
    ///         claimed cash is measured and added to `countedCash`, so the SY
    ///         exchange rate steps up on each coupon date.
    function touch() external {
        IBond3643 bond = IBond3643(bondToken);
        bond.accrue();

        uint256 before = IERC20(underlyingToken).balanceOf(address(this));
        uint256 count = bond.couponCount();
        uint256 claimed;
        for (uint256 i = 0; i < count; i++) {
            if (bond.claimableCoupon(i, address(this)) > 0) {
                try bond.claimCoupon(i) returns (uint256 cashOut) {
                    claimed += cashOut;
                } catch {}
            }
        }
        uint256 gained = IERC20(underlyingToken).balanceOf(address(this)) - before;
        if (gained > 0) countedCash += gained;
        if (claimed > 0) emit CouponsClaimed(count, gained);
    }
}
