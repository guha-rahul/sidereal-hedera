// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Minter-privileged surface of PT/SY share tokens, callable only by the
///         tokenizer. Standard ERC-20 methods are inherited separately.
interface IProtocolToken {
    function initialize(address admin, address tokenizer, address syToken, uint256 maturity) external;

    function mint(address to, uint256 amount) external;

    function burnFrom(address from, uint256 amount) external;

    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);
}
