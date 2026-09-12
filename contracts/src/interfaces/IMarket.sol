// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title IMarket
/// @notice The PT/SY market interface exposed by the AMM contract.
interface IMarket {
    function swapPtForSy(uint256 ptIn, uint256 minSyOut) external returns (uint256 syOut);

    function swapSyForPt(uint256 syIn, uint256 minPtOut) external returns (uint256 ptOut);

    function swapSyForYt(uint256 syIn, uint256 minYtOut) external returns (uint256 ytOut);

    function swapYtForSy(uint256 ytIn, uint256 minSyOut) external returns (uint256 syOut);

    function addLiquidity(
        uint256 ptIn,
        uint256 syIn,
        uint256 minLpOut
    ) external returns (uint256 lpOut);

    function removeLiquidity(
        uint256 lpIn,
        uint256 minPtOut,
        uint256 minSyOut
    ) external returns (uint256 ptOut, uint256 syOut);

    function impliedApy() external view returns (uint256);

    function maturity() external view returns (uint256);
}
