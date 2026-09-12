// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet-only demonstration cash. Not USDC or a redeemable stablecoin.
contract DemoCash is ERC20 {
    constructor(address issuer, uint256 supply) ERC20("Sidereal Demo USD (testnet only)", "sdUSD") {
        require(block.chainid == 296 || block.chainid == 31337, "testnet only");
        _mint(issuer, supply);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}
