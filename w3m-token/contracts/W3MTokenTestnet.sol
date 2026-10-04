// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract W3MTokenTestnet is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18;

    constructor(address initialHolder) ERC20("Web3Market Token", "W3M") {
        require(initialHolder != address(0), "Invalid initial holder");
        _mint(initialHolder, MAX_SUPPLY);
    }
}
