// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldStrategy} from "../interfaces/IYieldStrategy.sol";
import {WadMath} from "../libraries/WadMath.sol";

/// @title StandardizedYieldVault (sSY)
/// @notice Yield-source-agnostic SY vault. Binds one immutable strategy and
///         derives its exchange rate from that strategy's real holdings.
/// @dev **The rate stays derived, never set**:
///      `exchange_rate = strategy.totalAssets() * WAD / supply`. There is no
///      rate setter, which structurally rules out an admin-set rate.
///      `MINIMUM_SHARES` are minted to nobody on the first deposit so the
///      supply can never return to zero and no holder can own the entire supply.
contract StandardizedYieldVault is ERC20 {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    struct Config {
        address admin;
        address underlying;
        address strategy;
    }

    /// @dev Shares minted to nobody on the first deposit and never redeemable.
    ///      1e14 wei = 0.0001 tokens: small enough to never matter, large enough
    ///      to keep the supply from ever returning to zero.
    uint256 public constant MINIMUM_SHARES = 1e14;

    Config public config;
    bool private _initialized;
    uint256 public depositCap;

    mapping(address => uint256) private _principal;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidAmount();
    error InvalidExchangeRate();
    error InsufficientBalance();
    error StrategyMismatch();
    error SlippageExceeded();
    error StrategyDeliveryFailed();
    error InitialDepositTooSmall();
    error DepositCapExceeded();
    error NotAdmin();

    event Deposited(
        address indexed from,
        uint256 underlyingIn,
        uint256 assetsCredited,
        uint256 syOut,
        uint256 rate
    );
    event Redeemed(address indexed from, uint256 syIn, uint256 underlyingOut, uint256 rate);
    event DepositCapSet(uint256 oldCap, uint256 newCap);

    constructor() ERC20("Sidereal Standardized Yield", "sSY") {}

    /// @notice Binds the vault to one strategy, permanently.
    function initialize(address admin, address strategy_) external {
        if (_initialized) revert AlreadyInitialized();
        if (IYieldStrategy(strategy_).vault() != address(this)) revert StrategyMismatch();
        address underlying_ = IYieldStrategy(strategy_).underlying();
        _initialized = true;
        config = Config({admin: admin, underlying: underlying_, strategy: strategy_});
    }

    modifier initialized() {
        if (!_initialized) revert NotInitialized();
        _;
    }

    function strategy() external view returns (address) {
        return config.strategy;
    }

    function underlying() external view returns (address) {
        return config.underlying;
    }

    function totalAssets() public view returns (uint256) {
        return IYieldStrategy(config.strategy).totalAssets();
    }

    function maxWithdraw() external view returns (uint256) {
        return IYieldStrategy(config.strategy).maxWithdraw();
    }

    function totalShares() external view returns (uint256) {
        return totalSupply();
    }

    function shareBalance(address holder) external view returns (uint256) {
        return balanceOf(holder);
    }

    /// @notice Derived exchange rate: strategy assets per SY share, WAD-scaled.
    function exchangeRate() public view returns (uint256) {
        return _exchangeRate(totalAssets(), totalSupply());
    }

    function _exchangeRate(uint256 assets, uint256 supply) internal pure returns (uint256) {
        if (supply == 0) {
            if (assets == 0) return WadMath.WAD;
            revert InvalidExchangeRate();
        }
        uint256 rate = WadMath.mulDivDown(assets, WadMath.WAD, supply);
        if (rate == 0) revert InvalidExchangeRate();
        return rate;
    }

    /// @notice Sets the deposit ceiling (0 = uncapped). Admin only; gates deposit
    ///         and nothing else.
    function setDepositCap(address admin, uint256 cap) external initialized {
        if (admin != config.admin) revert NotAdmin();
        uint256 old = depositCap;
        depositCap = cap;
        emit DepositCapSet(old, cap);
    }

    /// @notice SY `amount` of underlying would mint, ignoring upstream rounding.
    function previewDeposit(uint256 amount) public view returns (uint256) {
        if (amount == 0) revert InvalidAmount();
        uint256 cap = depositCap;
        if (cap > 0 && totalAssets() >= cap) revert DepositCapExceeded();
        uint256 rate = exchangeRate();
        uint256 minted = WadMath.mulDivDown(amount, WadMath.WAD, rate);
        uint256 supply = totalSupply();
        if (supply == 0) {
            if (minted <= MINIMUM_SHARES) revert InitialDepositTooSmall();
            return minted - MINIMUM_SHARES;
        }
        if (minted == 0) revert InvalidAmount();
        return minted;
    }

    /// @notice Underlying `syAmount` would redeem at the current rate.
    function previewRedeem(uint256 syAmount) public view returns (uint256) {
        if (syAmount == 0) revert InvalidAmount();
        return WadMath.mulDivDown(syAmount, exchangeRate(), WadMath.WAD);
    }

    /// @notice Deposits `amount` underlying and mints SY, never fewer than
    ///         `minSyOut`.
    function deposit(uint256 amount, uint256 minSyOut) public initialized returns (uint256) {
        if (amount == 0) revert InvalidAmount();
        uint256 rate = exchangeRate();
        address underlying_ = config.underlying;
        address strategy_ = config.strategy;

        IERC20(underlying_).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(underlying_).forceApprove(strategy_, amount);
        uint256 assetsCredited = IYieldStrategy(strategy_).deposit(address(this), amount);
        IERC20(underlying_).forceApprove(strategy_, 0);
        if (assetsCredited == 0) revert StrategyDeliveryFailed();

        uint256 cap = depositCap;
        if (cap > 0 && IYieldStrategy(strategy_).totalAssets() > cap) revert DepositCapExceeded();

        uint256 minted = WadMath.mulDivDown(assetsCredited, WadMath.WAD, rate);
        uint256 total = totalSupply();
        uint256 shares;
        if (total == 0) {
            if (minted <= MINIMUM_SHARES) revert InitialDepositTooSmall();
            shares = minted - MINIMUM_SHARES;
        } else {
            shares = minted;
        }
        if (shares == 0) revert InvalidAmount();
        if (shares < minSyOut) revert SlippageExceeded();

        // Principal is credited for shares actually received, not the locked
        // ones, so accruedYield opens at zero rather than slightly negative.
        uint256 principalCredit = WadMath.mulDivDown(amount, shares, minted);
        _principal[msg.sender] += principalCredit;
        _mint(msg.sender, shares);
        // The first deposit additionally funds MINIMUM_SHARES that belong to
        // nobody: minted to a burn address, so supply can never return to zero.
        if (total == 0) {
            _mint(address(0x000000000000000000000000000000000000dEaD), MINIMUM_SHARES);
        }

        emit Deposited(msg.sender, amount, assetsCredited, shares, rate);
        return shares;
    }

    /// @notice Convenience overload matching `IStandardizedYield`.
    function deposit(uint256 amount) external returns (uint256) {
        return deposit(amount, 0);
    }

    /// @notice Burns SY and returns underlying, never less than
    ///         `minUnderlyingOut`.
    function redeem(
        uint256 syAmount,
        uint256 minUnderlyingOut
    ) public initialized returns (uint256 delivered) {
        if (syAmount == 0) revert InvalidAmount();
        uint256 rate = exchangeRate();
        address underlying_ = config.underlying;
        address strategy_ = config.strategy;

        uint256 currentShares = balanceOf(msg.sender);
        uint256 currentPrincipal = _principal[msg.sender];
        if (syAmount > currentShares) revert InsufficientBalance();

        uint256 requested = WadMath.mulDivDown(syAmount, rate, WadMath.WAD);
        if (requested == 0) revert InvalidAmount();

        uint256 principalOut = currentShares == 0
            ? 0
            : WadMath.mulDivDown(currentPrincipal, syAmount, currentShares);

        // Burn up front, before any external call.
        _principal[msg.sender] = currentPrincipal - principalOut;
        _burn(msg.sender, syAmount);

        uint256 before = IERC20(underlying_).balanceOf(address(this));
        IYieldStrategy(strategy_).withdraw(address(this), requested, minUnderlyingOut);
        uint256 afterBal = IERC20(underlying_).balanceOf(address(this));
        delivered = afterBal - before;
        if (delivered == 0 || delivered < minUnderlyingOut) revert StrategyDeliveryFailed();

        uint256 burned = syAmount;
        if (delivered < requested) {
            uint256 proportional = WadMath.mulDivUp(delivered, WadMath.WAD, rate);
            burned = proportional < syAmount ? proportional : syAmount;
        }
        if (burned < syAmount) {
            uint256 refundShares = syAmount - burned;
            uint256 refundPrincipal = WadMath.mulDivDown(principalOut, refundShares, syAmount);
            _principal[msg.sender] += refundPrincipal;
            _mint(msg.sender, refundShares);
        }

        IERC20(underlying_).safeTransfer(msg.sender, delivered);
        emit Redeemed(msg.sender, burned, delivered, rate);
    }

    /// @notice Convenience overload matching `IStandardizedYield`.
    function redeem(uint256 syAmount) external returns (uint256) {
        return redeem(syAmount, 0);
    }

    function accruedYield(address holder) external view returns (uint256) {
        uint256 rate = exchangeRate();
        uint256 shares = balanceOf(holder);
        uint256 value = WadMath.mulDivDown(shares, rate, WadMath.WAD);
        uint256 principal = _principal[holder];
        return value > principal ? value - principal : 0;
    }

    function touch() external initialized {
        IYieldStrategy(config.strategy).touch();
    }
}
