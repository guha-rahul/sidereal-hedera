// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMarket} from "./interfaces/IMarket.sol";
import {IStandardizedYield} from "./interfaces/IStandardizedYield.sol";
import {ITokenizer} from "./interfaces/ITokenizer.sol";
import {WadMath} from "./libraries/WadMath.sol";

/// @title AmmMarket
/// @notice Pendle-style time-decay AMM for PT/SY with flash-routed YT swaps and
///         an internal TWAP.
/// @dev The curve is
///      `exchange_rate = exp(ln(proportion / (1 - proportion)) / (r * tau) + a)`
///      where `proportion = total_pt / (total_pt + total_asset)`. Reserves are
///      asset-denominated for the curve (`total_asset` is the SY reserve valued
///      at the SY exchange rate), while `state.totalSy` stays authoritative in
///      SY shares. Every crossing of that boundary uses the same rounding the
///      tokenizer uses, so the AMM and tokenizer never disagree on units.
contract AmmMarket is IMarket {
    using SafeERC20 for IERC20;
    using WadMath for uint256;

    struct Config {
        address admin;
        address ptToken;
        address syToken;
        address ytToken;
        address tokenizer;
        uint256 maturity;
        uint256 scalarRoot;
        uint256 initialAnchor;
        uint256 feeBps;
        uint256 twapWindow;
    }

    struct State {
        uint256 totalPt;
        uint256 totalSy;
        uint256 totalLp;
        int256 lastLnImpliedRate;
        int256 twapLnImpliedRate;
        uint256 lastObservation;
        uint256 warmupUntil;
    }

    struct Precompute {
        uint256 rateScalar;
        uint256 totalAsset;
        uint256 rateAnchor;
        uint256 timeToExpiry;
        uint256 syRate;
    }

    enum PtOutProbe {
        TooSmall,
        Priced,
        TooLarge
    }

    enum YtBuyProbe {
        TooSmall,
        Affordable,
        TooLarge
    }

    Config public config;
    State public state;
    bool private _initialized;
    address private immutable _initializer = msg.sender;
    mapping(address => uint256) public lpBalance;

    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant MAX_MARKET_PROPORTION = (WadMath.WAD * 96) / 100;
    uint256 internal constant MAX_SCALAR_ROOT = 10 * WadMath.WAD;
    uint256 internal constant MAX_ANCHOR = 2 * WadMath.WAD;
    /// @dev 100 billion 18-decimal tokens, matching the source's 1e18 cap at 7
    ///      decimals. Bounds input amounts and search highs.
    uint256 internal constant MAX_RESERVE_UNITS = 1e29;
    uint256 internal constant MINIMUM_LIQUIDITY = 1e14;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidMaturity();
    error InvalidAmount();
    error InvalidScalarRoot();
    error InvalidAnchor();
    error InvalidFee();
    error InvalidTwapWindow();
    error MarketNotSeeded();
    error MarketMatured();
    error SlippageExceeded();
    error InsufficientLiquidity();
    error MathOverflow();
    error MarketProportionTooHigh();
    error ExchangeRateBelowOne();
    error UnsupportedRoute();
    error TradeNotFound();
    error InputOutOfBounds();
    error InvalidSyRate();
    error NotAdmin();

    event FeeSet(address indexed admin, uint256 oldFeeBps, uint256 newFeeBps);
    event Swapped(address indexed trader, uint8 route, uint256 amountIn, uint256 amountOut);
    event LiquidityAdded(address indexed provider, uint256 ptIn, uint256 syIn, uint256 lpOut);
    event LiquidityRemoved(address indexed provider, uint256 lpIn, uint256 ptOut, uint256 syOut);

    function initialize(
        address admin,
        address ptToken,
        address syToken,
        address ytToken,
        address tokenizer,
        uint256 maturity_,
        uint256 scalarRoot,
        uint256 initialAnchor,
        uint256 feeBps,
        uint256 twapWindow
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (msg.sender != _initializer) revert NotAdmin();
        if (maturity_ <= block.timestamp) revert InvalidMaturity();
        if (scalarRoot == 0) revert InvalidScalarRoot();
        if (scalarRoot > MAX_SCALAR_ROOT) revert InputOutOfBounds();
        if (initialAnchor < WadMath.WAD) revert InvalidAnchor();
        if (initialAnchor > MAX_ANCHOR) revert InputOutOfBounds();
        if (feeBps >= BPS_DENOMINATOR) revert InvalidFee();
        if (twapWindow == 0) revert InvalidTwapWindow();

        _initialized = true;
        config = Config({
            admin: admin,
            ptToken: ptToken,
            syToken: syToken,
            ytToken: ytToken,
            tokenizer: tokenizer,
            maturity: maturity_,
            scalarRoot: scalarRoot,
            initialAnchor: initialAnchor,
            feeBps: feeBps,
            twapWindow: twapWindow
        });
        state = State({
            totalPt: 0,
            totalSy: 0,
            totalLp: 0,
            lastLnImpliedRate: 0,
            twapLnImpliedRate: 0,
            lastObservation: block.timestamp,
            warmupUntil: block.timestamp + twapWindow
        });

        // The AMM's flash split pulls SY from the pool through the tokenizer.
        IERC20(syToken).forceApprove(tokenizer, type(uint256).max);
    }

    // --- admin / views ------------------------------------------------------

    function setFee(address admin, uint256 feeBps) external {
        Config memory c = _readConfig();
        if (msg.sender != c.admin || admin != c.admin) revert NotAdmin();
        if (feeBps >= BPS_DENOMINATOR) revert InvalidFee();
        uint256 old = c.feeBps;
        config.feeBps = feeBps;
        emit FeeSet(admin, old, feeBps);
    }

    function reservePt() external view returns (uint256) {
        Config memory c = _readConfig();
        return IERC20(c.ptToken).balanceOf(address(this));
    }

    function reserveSy() external view returns (uint256) {
        Config memory c = _readConfig();
        return IERC20(c.syToken).balanceOf(address(this));
    }

    function totalLp() external view returns (uint256) {
        return state.totalLp;
    }

    function quotePtForSy(uint256 ptIn) external view returns (uint256) {
        (Config memory c, State memory s, Precompute memory p) = _loadLiveMarket(ptIn);
        return _exactPtInSyOut(c, s, p, ptIn);
    }

    function quoteSyForPt(uint256 syIn) external view returns (uint256) {
        (Config memory c, State memory s, Precompute memory p) = _loadLiveMarket(syIn);
        return _exactSyInPtOut(c, s, p, syIn);
    }

    function quoteSyForPtCost(uint256 syIn) external view returns (uint256) {
        (Config memory c, State memory s, Precompute memory p) = _loadLiveMarket(syIn);
        uint256 ptOut = _exactSyInPtOut(c, s, p, syIn);
        return _exactPtOutSyIn(c, s, p, ptOut);
    }

    function quoteSyForYt(uint256 syIn) external view returns (uint256) {
        (Config memory c, State memory s, Precompute memory p) = _loadLiveMarket(syIn);
        (uint256 ytOut,) = _solveYtOutForSyIn(c, s, p, syIn);
        return ytOut;
    }

    function quoteSyForYtCost(uint256 syIn) external view returns (uint256) {
        (Config memory c, State memory s, Precompute memory p) = _loadLiveMarket(syIn);
        (, uint256 cost) = _solveYtOutForSyIn(c, s, p, syIn);
        return cost;
    }

    function quoteYtForSy(uint256 ytIn) external view returns (uint256) {
        (Config memory c, State memory s, Precompute memory p) = _loadLiveMarket(ytIn);
        uint256 syCost = _exactPtOutSyIn(c, s, p, ytIn);
        uint256 syValue = _sharesOutForFaceDown(ytIn, p.syRate);
        if (syCost >= syValue) revert InsufficientLiquidity();
        return syValue - syCost;
    }

    function spotApy() external view returns (uint256) {
        Config memory c = _readConfig();
        if (block.timestamp >= c.maturity) return 0;
        State memory s = state;
        if (s.totalLp == 0) return 0;
        return _lnRateToBps(s.lastLnImpliedRate);
    }

    function twapApy() external view returns (uint256) {
        Config memory c = _readConfig();
        if (block.timestamp >= c.maturity) return 0;
        return _lnRateToBps(state.twapLnImpliedRate);
    }

    function twapWarmingUp() external view returns (bool) {
        return block.timestamp < state.warmupUntil;
    }

    // --- IMarket ------------------------------------------------------------

    function swapPtForSy(uint256 ptIn, uint256 minSyOut) external returns (uint256) {
        Config memory c = _readConfig();
        requireLive(c);
        if (ptIn == 0 || ptIn > MAX_RESERVE_UNITS) revert InvalidAmount();
        State memory s = _readState();
        requireSeeded(s);
        Precompute memory p = _precompute(c, s);
        int256 prevailing = s.lastLnImpliedRate;

        uint256 syOut = _exactPtInSyOut(c, s, p, ptIn);
        if (syOut < minSyOut) revert SlippageExceeded();
        s.totalPt += ptIn;
        s.totalSy -= syOut;
        s.lastLnImpliedRate = _getLnImpliedRateOrPanic(
            s.totalPt, _assetValueOfShares(s.totalSy, p.syRate), p.rateScalar, p.rateAnchor, p.timeToExpiry
        );

        _transferIn(c.ptToken, msg.sender, ptIn);
        _transferOut(c.syToken, msg.sender, syOut);
        _settleAndRecord(c, s, prevailing);
        emit Swapped(msg.sender, 0, ptIn, syOut);
        return syOut;
    }

    function swapSyForPt(uint256 syIn, uint256 minPtOut) external returns (uint256) {
        Config memory c = _readConfig();
        requireLive(c);
        if (syIn == 0 || syIn > MAX_RESERVE_UNITS) revert InvalidAmount();
        State memory s = _readState();
        requireSeeded(s);
        Precompute memory p = _precompute(c, s);
        int256 prevailing = s.lastLnImpliedRate;

        uint256 ptOut = _exactSyInPtOut(c, s, p, syIn);
        if (ptOut < minPtOut) revert SlippageExceeded();

        uint256 requiredSy = _exactPtOutSyIn(c, s, p, ptOut);
        if (requiredSy > syIn) revert SlippageExceeded();
        s.totalPt -= ptOut;
        s.totalSy += requiredSy;
        s.lastLnImpliedRate = _getLnImpliedRateOrPanic(
            s.totalPt, _assetValueOfShares(s.totalSy, p.syRate), p.rateScalar, p.rateAnchor, p.timeToExpiry
        );

        _transferIn(c.syToken, msg.sender, requiredSy);
        _transferOut(c.ptToken, msg.sender, ptOut);
        _settleAndRecord(c, s, prevailing);
        emit Swapped(msg.sender, 1, syIn, ptOut);
        return ptOut;
    }

    function swapSyForYt(uint256 syIn, uint256 minYtOut) external returns (uint256) {
        Config memory c = _readConfig();
        requireLive(c);
        if (syIn == 0 || syIn > MAX_RESERVE_UNITS) revert InvalidAmount();
        State memory s = _readState();
        requireSeeded(s);
        Precompute memory p = _precompute(c, s);
        int256 prevailing = s.lastLnImpliedRate;

        uint256 rate = p.syRate;
        (uint256 ytOut, uint256 buyerCost) = _solveYtOutForSyIn(c, s, p, syIn);
        if (ytOut < minYtOut) revert SlippageExceeded();

        // The pool keeps the PT the split mints, so the curve moves as if it
        // bought `ytOut` PT; `syFunded` is the SY the curve pays for that PT.
        uint256 syFunded = _applyExactPtInTrade(c, s, p, ytOut);

        uint256 sharesToSplit = _sharesInForFaceUp(ytOut, rate);
        uint256 actualCost = sharesToSplit - syFunded;
        if (buyerCost < actualCost || buyerCost > actualCost + 1 || buyerCost > syIn) {
            revert InsufficientLiquidity();
        }

        _transferIn(c.syToken, msg.sender, buyerCost);
        (, uint256 ytMinted) = ITokenizer(c.tokenizer).split(sharesToSplit);
        if (ytMinted < ytOut) revert InsufficientLiquidity();
        _transferOut(c.ytToken, msg.sender, ytOut);
        _settleAndRecord(c, s, prevailing);
        emit Swapped(msg.sender, 2, syIn, ytOut);
        return ytOut;
    }

    function swapYtForSy(uint256 ytIn, uint256 minSyOut) external returns (uint256) {
        Config memory c = _readConfig();
        requireLive(c);
        if (ytIn == 0 || ytIn > MAX_RESERVE_UNITS) revert InvalidAmount();
        State memory s = _readState();
        requireSeeded(s);
        Precompute memory p = _precompute(c, s);
        int256 prevailing = s.lastLnImpliedRate;

        uint256 syCost = _exactPtOutSyIn(c, s, p, ytIn);
        uint256 syValue = _sharesOutForFaceDown(ytIn, p.syRate);
        if (syValue <= syCost) revert InsufficientLiquidity();
        uint256 syOut = syValue - syCost;
        if (syOut < minSyOut) revert SlippageExceeded();

        uint256 charged = _applyExactSyInTrade(c, s, p, syCost, ytIn);
        if (charged != syCost) revert InsufficientLiquidity();

        _transferIn(c.ytToken, msg.sender, ytIn);
        uint256 syFromRecombine = ITokenizer(c.tokenizer).recombine(ytIn, ytIn);
        if (syFromRecombine < syValue) revert InsufficientLiquidity();
        _transferOut(c.syToken, msg.sender, syOut);
        _settleAndRecord(c, s, prevailing);
        emit Swapped(msg.sender, 3, ytIn, syOut);
        return syOut;
    }

    function addLiquidity(
        uint256 ptIn,
        uint256 syIn,
        uint256 minLpOut
    ) external returns (uint256 lpOut) {
        Config memory c = _readConfig();
        requireLive(c);
        if (ptIn == 0 || ptIn > MAX_RESERVE_UNITS) revert InvalidAmount();
        if (syIn == 0 || syIn > MAX_RESERVE_UNITS) revert InvalidAmount();

        State memory s = _readState();
        uint256 now_ = block.timestamp;
        uint256 ptUsed;
        uint256 syUsed;

        if (s.totalLp == 0) {
            uint256 grossLp = WadMath.sqrt(ptIn * syIn);
            if (grossLp <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();

            s.totalPt = ptIn;
            s.totalSy = syIn;
            s.totalLp = grossLp;
            uint256 timeToExpiry = _timeToExpiry(c);
            uint256 rateScalar = _getRateScalar(c.scalarRoot, timeToExpiry);
            uint256 syRate = _syRate(c);
            s.lastLnImpliedRate = _getLnImpliedRateOrPanic(
                s.totalPt,
                _assetValueOfShares(s.totalSy, syRate),
                rateScalar,
                c.initialAnchor,
                timeToExpiry
            );
            s.twapLnImpliedRate = s.lastLnImpliedRate;
            s.lastObservation = now_;
            s.warmupUntil = now_ + c.twapWindow;
            ptUsed = ptIn;
            syUsed = syIn;
            lpOut = grossLp - MINIMUM_LIQUIDITY;
        } else {
            uint256 lpByPt = WadMath.mulDivDown(ptIn, s.totalLp, s.totalPt);
            uint256 lpBySy = WadMath.mulDivDown(syIn, s.totalLp, s.totalSy);
            lpOut = lpByPt < lpBySy ? lpByPt : lpBySy;
            if (lpOut == 0) revert InsufficientLiquidity();

            ptUsed = WadMath.mulDivUp(s.totalPt, lpOut, s.totalLp);
            syUsed = WadMath.mulDivUp(s.totalSy, lpOut, s.totalLp);
            s.totalPt = _checkedBoundedReserveAdd(s.totalPt, ptUsed);
            s.totalSy = _checkedBoundedReserveAdd(s.totalSy, syUsed);
            s.totalLp += lpOut;
        }

        if (lpOut < minLpOut) revert SlippageExceeded();
        lpBalance[msg.sender] += lpOut;
        _transferIn(c.ptToken, msg.sender, ptUsed);
        _transferIn(c.syToken, msg.sender, syUsed);
        _reconcileReserves(c, s);
        _writeState(s);
        emit LiquidityAdded(msg.sender, ptUsed, syUsed, lpOut);
    }

    function removeLiquidity(
        uint256 lpIn,
        uint256 minPtOut,
        uint256 minSyOut
    ) external returns (uint256 ptOut, uint256 syOut) {
        Config memory c = _readConfig();
        if (lpIn == 0 || lpIn > MAX_RESERVE_UNITS) revert InvalidAmount();

        State memory s = _readState();
        if (s.totalLp <= 0 || s.totalPt <= 0 || s.totalSy <= 0) revert MarketNotSeeded();

        uint256 holderLp = lpBalance[msg.sender];
        if (lpIn > holderLp || lpIn >= s.totalLp) revert InsufficientLiquidity();

        syOut = WadMath.mulDivDown(lpIn, s.totalSy, s.totalLp);
        ptOut = WadMath.mulDivDown(lpIn, s.totalPt, s.totalLp);
        if (syOut == 0 && ptOut == 0) revert InsufficientLiquidity();
        if (ptOut < minPtOut || syOut < minSyOut) revert SlippageExceeded();

        lpBalance[msg.sender] = holderLp - lpIn;
        s.totalLp -= lpIn;
        s.totalSy -= syOut;
        s.totalPt -= ptOut;
        _transferOut(c.ptToken, msg.sender, ptOut);
        _transferOut(c.syToken, msg.sender, syOut);
        _reconcileReserves(c, s);
        _writeState(s);
        emit LiquidityRemoved(msg.sender, lpIn, ptOut, syOut);
    }

    function impliedApy() external view returns (uint256) {
        Config memory c = _readConfig();
        if (block.timestamp >= c.maturity) return 0;
        State memory s = state;
        if (s.totalLp == 0) return 0;
        return _lnRateToBps(s.lastLnImpliedRate);
    }

    function maturity() external view returns (uint256) {
        return config.maturity;
    }

    // --- loading ------------------------------------------------------------

    function _readConfig() internal view returns (Config memory) {
        if (!_initialized) revert NotInitialized();
        return config;
    }

    function _readState() internal view returns (State memory) {
        return state;
    }

    function _writeState(State memory s) internal {
        state = s;
    }

    function _loadLiveMarket(
        uint256 amount
    ) internal view returns (Config memory c, State memory s, Precompute memory p) {
        if (amount == 0 || amount > MAX_RESERVE_UNITS) revert InvalidAmount();
        c = _readConfig();
        requireLive(c);
        s = _readState();
        requireSeeded(s);
        p = _precompute(c, s);
    }

    function requireLive(Config memory c) internal view {
        if (block.timestamp >= c.maturity) revert MarketMatured();
    }

    function requireSeeded(State memory s) internal pure {
        if (s.totalLp <= 0 || s.totalPt <= 0 || s.totalSy <= 0) revert MarketNotSeeded();
    }

    function _timeToExpiry(Config memory c) internal view returns (uint256) {
        if (c.maturity <= block.timestamp) revert MarketMatured();
        return c.maturity - block.timestamp;
    }

    function _precompute(Config memory c, State memory s) internal view returns (Precompute memory p) {
        p.timeToExpiry = _timeToExpiry(c);
        p.rateScalar = _getRateScalar(c.scalarRoot, p.timeToExpiry);
        p.syRate = _syRate(c);
        p.totalAsset = _assetValueOfShares(s.totalSy, p.syRate);
        if (s.totalPt == 0 || p.totalAsset == 0) revert MarketNotSeeded();
        p.rateAnchor = _getRateAnchor(
            s.totalPt, s.lastLnImpliedRate, p.totalAsset, p.rateScalar, p.timeToExpiry
        );
    }

    // --- curve math ---------------------------------------------------------

    function _syRate(Config memory c) internal view returns (uint256) {
        uint256 rate = IStandardizedYield(c.syToken).exchangeRate();
        if (rate == 0) revert InvalidSyRate();
        return rate;
    }

    function _getRateScalar(uint256 scalarRoot, uint256 timeToExpiry) internal pure returns (uint256) {
        uint256 rateScalar = (scalarRoot * WadMath.IMPLIED_RATE_TIME) / timeToExpiry;
        if (rateScalar == 0) revert InvalidScalarRoot();
        return rateScalar;
    }

    function _getRateAnchor(
        uint256 totalPt,
        int256 lastLnImpliedRate,
        uint256 totalAsset,
        uint256 rateScalar,
        uint256 timeToExpiry
    ) internal pure returns (uint256) {
        uint256 exchangeRate = _exchangeRateFromImpliedRate(lastLnImpliedRate, timeToExpiry);
        if (exchangeRate < WadMath.WAD) revert ExchangeRateBelowOne();

        uint256 proportion = WadMath.mulDivDown(totalPt, WadMath.WAD, totalPt + totalAsset);
        int256 lnProportion = _logProportion(proportion);
        int256 anchor = int256(exchangeRate) - _mulDivSigned(lnProportion, WadMath.WAD, rateScalar);
        if (anchor < 0) revert MathOverflow();
        return uint256(anchor);
    }

    function _getLnImpliedRateOrPanic(
        uint256 totalPt,
        uint256 totalAsset,
        uint256 rateScalar,
        uint256 rateAnchor,
        uint256 timeToExpiry
    ) internal pure returns (int256) {
        uint256 exchangeRate = _getExchangeRateOrPanic(totalPt, totalAsset, rateScalar, rateAnchor, 0);
        int256 lnRate = WadMath.lnWad(exchangeRate);
        return _mulDivSigned(lnRate, WadMath.IMPLIED_RATE_TIME, timeToExpiry);
    }

    function _exchangeRateFromImpliedRate(
        int256 lnImpliedRate,
        uint256 timeToExpiry
    ) internal pure returns (uint256) {
        int256 rt = _mulDivSigned(lnImpliedRate, timeToExpiry, WadMath.IMPLIED_RATE_TIME);
        return WadMath.expWad(rt);
    }

    function _logProportion(uint256 proportion) internal pure returns (int256) {
        uint256 complement = WadMath.WAD - proportion;
        if (complement == 0) revert MarketProportionTooHigh();
        uint256 ratio = WadMath.mulDivDown(proportion, WadMath.WAD, complement);
        return WadMath.lnWad(ratio);
    }

    function _getExchangeRateOrPanic(
        uint256 totalPt,
        uint256 totalAsset,
        uint256 rateScalar,
        uint256 rateAnchor,
        int256 netPtToAccount
    ) internal pure returns (uint256) {
        int256 numerator = int256(totalPt) - netPtToAccount;
        if (numerator <= 0) revert MathOverflow();
        uint256 proportion = WadMath.mulDivDown(uint256(numerator), WadMath.WAD, totalPt + totalAsset);
        if (proportion > MAX_MARKET_PROPORTION) revert MarketProportionTooHigh();

        int256 lnProportion = _logProportion(proportion);
        int256 exchangeRate = _mulDivSigned(lnProportion, WadMath.WAD, rateScalar) + int256(rateAnchor);
        if (exchangeRate < int256(WadMath.WAD)) revert ExchangeRateBelowOne();
        return uint256(exchangeRate);
    }

    function _tryGetExchangeRate(
        uint256 totalPt,
        uint256 totalAsset,
        uint256 rateScalar,
        uint256 rateAnchor,
        int256 netPtToAccount
    ) internal pure returns (bool, uint256) {
        int256 numerator = int256(totalPt) - netPtToAccount;
        if (numerator <= 0) return (false, 0);
        if (totalPt + totalAsset == 0) return (false, 0);
        uint256 proportion = WadMath.mulDivDown(uint256(numerator), WadMath.WAD, totalPt + totalAsset);
        if (proportion == 0 || proportion > MAX_MARKET_PROPORTION) return (false, 0);
        uint256 complement = WadMath.WAD - proportion;
        if (complement == 0) return (false, 0);
        uint256 ratio = WadMath.mulDivDown(proportion, WadMath.WAD, complement);
        (bool ok, int256 lnProportion) = WadMath.tryLnWad(ratio);
        if (!ok) return (false, 0);
        int256 exchangeRate =
            _mulDivSigned(lnProportion, WadMath.WAD, rateScalar) + int256(rateAnchor);
        if (exchangeRate < int256(WadMath.WAD)) return (false, 0);
        return (true, uint256(exchangeRate));
    }

    function _lnRateToBps(int256 lnRate) internal pure returns (uint256) {
        if (lnRate <= 0) return 0;
        return uint256((lnRate * int256(BPS_DENOMINATOR)) / int256(WadMath.WAD));
    }

    function _mulDivSigned(int256 a, uint256 b, uint256 c) internal pure returns (int256) {
        return (a * int256(b)) / int256(c);
    }

    // --- unit conversions ---------------------------------------------------

    function _assetValueOfShares(uint256 shares, uint256 rate) internal pure returns (uint256) {
        return WadMath.mulDivDown(shares, rate, WadMath.WAD);
    }

    function _sharesInForFaceUp(uint256 face, uint256 rate) internal pure returns (uint256) {
        return WadMath.mulDivUp(face, WadMath.WAD, rate);
    }

    function _sharesOutForFaceDown(uint256 face, uint256 rate) internal pure returns (uint256) {
        return WadMath.mulDivDown(face, WadMath.WAD, rate);
    }

    // --- exact-in / exact-out -----------------------------------------------

    function _exactPtInSyOut(
        Config memory c,
        State memory s,
        Precompute memory p,
        uint256 ptIn
    ) internal pure returns (uint256) {
        uint256 exchangeRate =
            _getExchangeRateOrPanic(s.totalPt, p.totalAsset, p.rateScalar, p.rateAnchor, -int256(ptIn));
        uint256 preFeeAssetOut = WadMath.mulDivDown(ptIn, WadMath.WAD, exchangeRate);
        uint256 fee = WadMath.mulDivUp(preFeeAssetOut, c.feeBps, BPS_DENOMINATOR);
        uint256 assetOut = preFeeAssetOut - fee;
        uint256 syOut = _sharesOutForFaceDown(assetOut, p.syRate);
        if (syOut == 0 || syOut >= s.totalSy) revert InsufficientLiquidity();
        if (!_postTradeRateIsRepresentable(p, s.totalPt + ptIn, s.totalSy - syOut)) {
            revert InsufficientLiquidity();
        }
        return syOut;
    }

    /// @dev Applies a "buy `ptOut` PT" leg, mutating state, and returns the SY the
    ///      curve charges. `syIn` is a budget: the residual is never credited to
    ///      reserves, so a liquidity-capped fill cannot donate the surplus to LPs.
    function _applyExactSyInTrade(
        Config memory c,
        State memory s,
        Precompute memory p,
        uint256 syIn,
        uint256 ptOut
    ) internal pure returns (uint256) {
        uint256 requiredSy = _exactPtOutSyIn(c, s, p, ptOut);
        if (requiredSy > syIn) revert SlippageExceeded();
        s.totalPt -= ptOut;
        s.totalSy = _checkedBoundedReserveAdd(s.totalSy, requiredSy);
        s.lastLnImpliedRate = _getLnImpliedRateOrPanic(
            s.totalPt, _assetValueOfShares(s.totalSy, p.syRate), p.rateScalar, p.rateAnchor, p.timeToExpiry
        );
        return requiredSy;
    }

    /// @dev Applies a "sell `ptIn` PT" leg funded from the pool, mutating state,
    ///      and returns the SY the curve pays out. Used by the YT buy route.
    function _applyExactPtInTrade(
        Config memory c,
        State memory s,
        Precompute memory p,
        uint256 ptIn
    ) internal pure returns (uint256) {
        uint256 syOut = _exactPtInSyOut(c, s, p, ptIn);
        s.totalPt = _checkedBoundedReserveAdd(s.totalPt, ptIn);
        s.totalSy -= syOut;
        s.lastLnImpliedRate = _getLnImpliedRateOrPanic(
            s.totalPt, _assetValueOfShares(s.totalSy, p.syRate), p.rateScalar, p.rateAnchor, p.timeToExpiry
        );
        return syOut;
    }

    function _exactSyInPtOut(
        Config memory c,
        State memory s,
        Precompute memory p,
        uint256 syIn
    ) internal pure returns (uint256) {
        uint256 low = 1;
        uint256 high = s.totalPt - 1;
        uint256 best = 0;
        while (low <= high) {
            uint256 mid = low + (high - low) / 2;
            (PtOutProbe kind, uint256 requiredSy) = _probePtOut(c, s, p, mid);
            if (kind == PtOutProbe.TooSmall) {
                low = mid + 1;
            } else if (kind == PtOutProbe.Priced && requiredSy <= syIn) {
                best = mid;
                low = mid + 1;
            } else {
                if (mid == 0) break;
                high = mid - 1;
            }
        }
        if (best == 0) revert TradeNotFound();
        return best;
    }

    function _exactPtOutSyIn(
        Config memory c,
        State memory s,
        Precompute memory p,
        uint256 ptOut
    ) internal pure returns (uint256) {
        (PtOutProbe kind, uint256 requiredSy) = _probePtOut(c, s, p, ptOut);
        if (kind != PtOutProbe.Priced) revert TradeNotFound();
        return requiredSy;
    }

    function _probePtOut(
        Config memory c,
        State memory s,
        Precompute memory p,
        uint256 ptOut
    ) internal pure returns (PtOutProbe, uint256) {
        if (ptOut == 0) return (PtOutProbe.TooSmall, 0);
        if (ptOut >= s.totalPt) return (PtOutProbe.TooLarge, 0);
        if (_proportionOverCap(s.totalPt, p.totalAsset, ptOut)) {
            return (PtOutProbe.TooSmall, 0);
        }

        (bool ok, uint256 exchangeRate) =
            _tryGetExchangeRate(s.totalPt, p.totalAsset, p.rateScalar, p.rateAnchor, int256(ptOut));
        if (!ok) return (PtOutProbe.TooLarge, 0);

        uint256 preFeeAssetIn = WadMath.mulDivUp(ptOut, WadMath.WAD, exchangeRate);
        uint256 fee = WadMath.mulDivUp(preFeeAssetIn, c.feeBps, BPS_DENOMINATOR);
        uint256 assetIn = preFeeAssetIn + fee;
        uint256 syIn = _sharesInForFaceUp(assetIn, p.syRate);

        uint256 postPt = s.totalPt - ptOut;
        uint256 postShares = s.totalSy + syIn;
        if (postPt == 0 || postShares == 0) return (PtOutProbe.TooLarge, 0);
        uint256 postAsset = _assetValueOfShares(postShares, p.syRate);
        if (postAsset == 0) return (PtOutProbe.TooLarge, 0);
        if (_proportionOverCap(postPt, postAsset, 0)) return (PtOutProbe.TooSmall, 0);
        (bool okPost,) = _tryGetExchangeRate(postPt, postAsset, p.rateScalar, p.rateAnchor, 0);
        if (!okPost) return (PtOutProbe.TooLarge, 0);

        return (PtOutProbe.Priced, syIn);
    }

    function _proportionOverCap(
        uint256 totalPt,
        uint256 totalAsset,
        uint256 netPtToAccount
    ) internal pure returns (bool) {
        if (totalPt <= netPtToAccount) return false;
        uint256 numerator = totalPt - netPtToAccount;
        uint256 denominator = totalPt + totalAsset;
        if (numerator == 0 || denominator == 0) return false;
        return WadMath.mulDivDown(numerator, WadMath.WAD, denominator) > MAX_MARKET_PROPORTION;
    }

    function _solveYtOutForSyIn(
        Config memory c,
        State memory s,
        Precompute memory p,
        uint256 syIn
    ) internal pure returns (uint256 best, uint256 bestCost) {
        uint256 low = 1;
        uint256 maxShares = syIn + s.totalSy;
        uint256 high = WadMath.mulDivDown(maxShares, p.syRate, WadMath.WAD);
        if (high > MAX_RESERVE_UNITS) high = MAX_RESERVE_UNITS;

        while (low <= high) {
            uint256 mid = low + (high - low) / 2;
            (YtBuyProbe kind, uint256 cost) = _probeYtBuy(c, s, p, mid, syIn);
            if (kind == YtBuyProbe.Affordable) {
                best = mid;
                bestCost = cost;
                low = mid + 1;
            } else if (kind == YtBuyProbe.TooSmall) {
                low = mid + 1;
            } else {
                if (mid == 0) break;
                high = mid - 1;
            }
        }
        if (best == 0) revert TradeNotFound();
    }

    function _probeYtBuy(
        Config memory c,
        State memory s,
        Precompute memory p,
        uint256 face,
        uint256 syIn
    ) internal pure returns (YtBuyProbe, uint256) {
        if (face == 0) return (YtBuyProbe.TooSmall, 0);
        (bool ok, uint256 exchangeRate) =
            _tryGetExchangeRate(s.totalPt, p.totalAsset, p.rateScalar, p.rateAnchor, -int256(face));
        if (!ok) return (YtBuyProbe.TooLarge, 0);

        uint256 preFeeAssetOut = WadMath.mulDivDown(face, WadMath.WAD, exchangeRate);
        uint256 fee = WadMath.mulDivUp(preFeeAssetOut, c.feeBps, BPS_DENOMINATOR);
        uint256 assetOut = preFeeAssetOut - fee;
        uint256 syPaid = _sharesOutForFaceDown(assetOut, p.syRate);
        if (syPaid == 0) return (YtBuyProbe.TooSmall, 0);
        if (syPaid >= s.totalSy) return (YtBuyProbe.TooLarge, 0);
        if (!_postTradeRateIsRepresentable(p, s.totalPt + face, s.totalSy - syPaid)) {
            return (YtBuyProbe.TooLarge, 0);
        }

        uint256 assetSpread = face - assetOut;
        uint256 cost = _sharesInForFaceUp(assetSpread, p.syRate) + 1;
        if (cost > syIn) return (YtBuyProbe.TooLarge, 0);
        return (YtBuyProbe.Affordable, cost);
    }

    function _postTradeRateIsRepresentable(
        Precompute memory p,
        uint256 postPt,
        uint256 postSyShares
    ) internal pure returns (bool) {
        if (postPt == 0 || postSyShares == 0) return false;
        uint256 postAsset = _assetValueOfShares(postSyShares, p.syRate);
        if (postAsset == 0) return false;
        (bool ok,) = _tryGetExchangeRate(postPt, postAsset, p.rateScalar, p.rateAnchor, 0);
        return ok;
    }

    // --- reserves / settlement ----------------------------------------------

    function _reconcileReserves(Config memory c, State memory s) internal view {
        s.totalPt = IERC20(c.ptToken).balanceOf(address(this));
        s.totalSy = IERC20(c.syToken).balanceOf(address(this));
    }

    function _settleAndRecord(Config memory c, State memory s, int256 prevailingLnRate) internal {
        _reconcileReserves(c, s);
        _syncTwap(c, s, prevailingLnRate);
        _writeState(s);
    }

    /// @dev Accumulates the rate that *prevailed* over the interval that just
    ///      closed. Weighting the post-trade rate would let an attacker snap the
    ///      oracle to a dislocation they choose and reverse in the same block.
    function _syncTwap(Config memory c, State memory s, int256 prevailingLnRate) internal view {
        uint256 now_ = block.timestamp;
        uint256 last = s.lastObservation;
        if (now_ <= last) return;
        uint256 elapsed = now_ - last;

        if (elapsed >= c.twapWindow) {
            s.twapLnImpliedRate = prevailingLnRate;
            s.warmupUntil = now_ + c.twapWindow;
        } else {
            uint256 weight = WadMath.mulDivDown(elapsed, WadMath.WAD, c.twapWindow);
            uint256 retained = WadMath.WAD - weight;
            int256 carried = _mulDivSigned(s.twapLnImpliedRate, retained, WadMath.WAD);
            int256 fresh = _mulDivSigned(prevailingLnRate, weight, WadMath.WAD);
            s.twapLnImpliedRate = carried + fresh;
        }
        s.lastObservation = now_;
    }

    function _checkedBoundedReserveAdd(uint256 lhs, uint256 rhs) internal pure returns (uint256) {
        uint256 value = lhs + rhs;
        if (value > MAX_RESERVE_UNITS) revert InputOutOfBounds();
        return value;
    }

    // --- token movement -----------------------------------------------------

    function _transferIn(address token, address from, uint256 amount) internal {
        if (amount == 0) return;
        IERC20(token).safeTransferFrom(from, address(this), amount);
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        IERC20(token).safeTransfer(to, amount);
    }
}
