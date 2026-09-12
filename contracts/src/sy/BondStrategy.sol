// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldStrategy} from "../interfaces/IYieldStrategy.sol";
import {IBond} from "../interfaces/IBond.sol";
import {WadMath} from "../libraries/WadMath.sol";

/// @title BondStrategy
/// @notice Sidereal yield source that holds an ERC-3643/ATS tokenized bond.
/// @dev The strategy seam requires that `totalAssets` values only what the
///      strategy itself put to work. This adapter therefore tracks
///      `accountedBonds` and `countedCash` explicitly: bond tokens or cash
///      donated by a plain transfer do not enter the valuation, so a donation
///      cannot move the SY exchange rate.
contract BondStrategy is IYieldStrategy {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    address public immutable vaultAddress;
    address public immutable bondToken;
    address public immutable underlyingToken;

    uint256 public accountedBonds;
    uint256 public countedCash;

    error AlreadyInitialized();
    error NotVault();
    error InvalidAmount();
    error SlippageExceeded();
    error StrategyDeliveryFailed();
    error UpstreamPaused();

    event BondDeposited(uint256 cashIn, uint256 bondOut, uint256 assetsCredited);
    event BondWithdrawn(uint256 cashRequested, uint256 bondRedeemed, uint256 delivered);

    constructor(address vault_, address bond_) {
        if (vault_ == address(0) || bond_ == address(0)) revert InvalidAmount();
        vaultAddress = vault_;
        bondToken = bond_;
        underlyingToken = IBond(bond_).denomination();
    }

    function underlying() external view returns (address) {
        return underlyingToken;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    /// @notice Bond value in cash (only accounted bonds) plus counted cash.
    function totalAssets() public view returns (uint256) {
        uint256 bondValue = IBond(bondToken).valueOf(accountedBonds);
        return bondValue + countedCash;
    }

    /// @notice Cash the bond itself can presently pay plus counted cash.
    function maxWithdraw() public view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 liquid = IBond(bondToken).availableLiquidity() + countedCash;
        return assets < liquid ? assets : liquid;
    }

    function deposit(address vault_, uint256 amount) external returns (uint256 credited) {
        if (msg.sender != vaultAddress || vault_ != vaultAddress) revert NotVault();
        if (amount == 0) revert InvalidAmount();

        uint256 beforeAssets = totalAssets();
        IERC20(underlyingToken).safeTransferFrom(vault_, address(this), amount);
        IERC20(underlyingToken).forceApprove(bondToken, amount);
        uint256 bondOut = IBond(bondToken).purchase(amount);
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
            uint256 vpu = IBond(bondToken).valuePerUnit();
            bondsToBurn = WadMath.mulDivUp(remaining, WadMath.WAD, vpu);
            if (bondsToBurn > accountedBonds) bondsToBurn = accountedBonds;
        }

        uint256 cashOut;
        if (bondsToBurn > 0) {
            cashOut = IBond(bondToken).redeem(bondsToBurn);
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

    /// @notice Permissionless upkeep. Pokes the bond's accrual so its value is
    ///         current; capitalized coupons need no separate sweep.
    function touch() external {
        IBond(bondToken).accrue();
    }
}
