// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title WadMath
/// @notice Integer fixed-point helpers shared by the protocol. All
///         transcendental math is integer-only, so results are deterministic
///         and free of floating-point variance.
library WadMath {
    /// @dev Asset-per-share fixed point scale (18 decimals).
    uint256 internal constant WAD = 1e18;

    /// @dev Basis-point denominator.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @dev ln(2) scaled by WAD.
    int256 internal constant LN2_WAD = 693_147_180_559_945_309;

    /// @dev Longest implied-rate extrapolation window, one year.
    uint256 internal constant IMPLIED_RATE_TIME = 365 days;

    /// @dev Curve ceiling on PT's share of the pool's asset value (96%).
    uint256 internal constant MAX_MARKET_PROPORTION = (WAD * 96) / 100;

    error MathOverflow();
    error InvalidLog();

    /// @notice floor(a * b / denominator), 512-bit intermediate.
    function mulDivDown(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256) {
        return Math.mulDiv(a, b, denominator, Math.Rounding.Floor);
    }

    /// @notice ceil(a * b / denominator), 512-bit intermediate.
    function mulDivUp(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256) {
        return Math.mulDiv(a, b, denominator, Math.Rounding.Ceil);
    }

    /// @notice Floor integer square root.
    function sqrt(uint256 value) internal pure returns (uint256) {
        if (value == 0) revert MathOverflow();
        return Math.sqrt(value);
    }

    /// @notice Natural log of a WAD-fixed positive value, WAD-fixed (signed).
    /// @dev Reverts on non-positive input or overflow.
    function lnWad(uint256 value) internal pure returns (int256) {
        (bool ok, int256 result) = tryLnWad(value);
        if (!ok) revert InvalidLog();
        return result;
    }

    /// @notice `lnWad` that reports failure instead of reverting.
    function tryLnWad(uint256 value) internal pure returns (bool ok, int256 result) {
        if (value == 0) return (false, 0);

        int256 k = 0;
        uint256 m = value;
        while (m >= 2 * WAD) {
            m /= 2;
            k += 1;
        }
        while (m < WAD) {
            unchecked {
                m *= 2;
            }
            k -= 1;
        }

        // z = (m - WAD) / (m + WAD), WAD-fixed, in [0, 1/3].
        uint256 z = ((m - WAD) * WAD) / (m + WAD);
        uint256 z2 = (z * z) / WAD;

        uint256 term = z;
        uint256 sum = z;
        uint256 n = 3;
        while (n <= 49) {
            term = (term * z2) / WAD;
            sum += term / n;
            n += 2;
        }

        uint256 lnMant = sum * 2;
        // k * LN2_WAD + lnMant fits comfortably: |k| << 127 and LN2_WAD ~ 0.69e18.
        result = k * LN2_WAD + int256(lnMant);
        return (true, result);
    }

    /// @notice e^x for WAD-fixed signed x, returned WAD-fixed.
    function expWad(int256 value) internal pure returns (uint256) {
        (bool ok, uint256 result) = tryExpWad(value);
        if (!ok) revert MathOverflow();
        return result;
    }

    /// @notice `expWad` that reports failure instead of reverting.
    function tryExpWad(int256 value) internal pure returns (bool ok, uint256 result) {
        int256 halfLn2 = LN2_WAD / 2;
        int256 k = value >= 0 ? (value + halfLn2) / LN2_WAD : (value - halfLn2) / LN2_WAD;
        int256 r = value - k * LN2_WAD; // |r| <= ln2/2

        int256 term = int256(WAD);
        int256 sum = int256(WAD);
        int256 i = 1;
        while (i <= 20) {
            term = ((term * r) / int256(WAD)) / i;
            if (term == 0) break;
            sum += term;
            i += 1;
        }

        if (sum < 0) return (false, 0);
        if (k >= 0) {
            if (k > 90) return (false, 0);
            return (true, uint256(sum) << uint256(k));
        }
        uint256 shift = uint256(-k);
        if (shift >= 127) return (true, 0);
        return (true, uint256(sum) >> shift);
    }
}
