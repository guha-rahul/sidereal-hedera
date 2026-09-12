// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Yield-token surface the tokenizer drives. All state-changing methods
///         are gated on the tokenizer address fixed at initialization.
interface IYieldToken {
    function initialize(address admin, address tokenizer, address syToken, uint256 maturity) external;

    function mint(address to, uint256 amount) external;

    function settle(address holder, uint256 rate) external returns (uint256 banked);

    function consume(address holder, uint256 amount) external;

    function burnSetSettled(address from, uint256 amount, uint256 rate) external;

    function yieldBasis(address holder) external view returns (uint256);

    function totalYieldBasis() external view returns (uint256);

    function checkpoint(address holder) external view returns (uint256);

    function accruedYield(address holder) external view returns (uint256);

    function totalAccruedYield() external view returns (uint256);

    function previewClaimYield(address holder) external view returns (uint256);
}
