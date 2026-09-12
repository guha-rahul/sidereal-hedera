// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Tokenizer surface consumed by the yield token, AMM, and SDK.
interface ITokenizer {
    function maturity() external view returns (uint256);

    function isMatured() external view returns (bool);

    function yieldFeeBps() external view returns (uint256);

    function observeRate() external returns (uint256);

    function freezeMaturityRate() external returns (uint256);

    function maturityRate() external view returns (uint256);

    function previewSplit(uint256 syAmount) external view returns (uint256 ptOut, uint256 ytOut);

    function previewRecombine(
        uint256 ptAmount,
        uint256 ytAmount
    ) external view returns (uint256 syOut);

    function split(uint256 syAmount) external returns (uint256 ptOut, uint256 ytOut);

    function recombine(
        uint256 ptAmount,
        uint256 ytAmount
    ) external returns (uint256 syOut);

    function redeemAtMaturity(uint256 ptAmount) external returns (uint256 syOut);

    function availableYieldSurplus() external view returns (uint256);

    function claimYield() external returns (uint256 net);
}
