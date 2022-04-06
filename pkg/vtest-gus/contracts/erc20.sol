// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract erc20 is ERC20, Ownable {
    constructor() ERC20("erc20", "erc20") {}

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
