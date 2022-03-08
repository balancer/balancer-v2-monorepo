// SPDX-License-Identifier: GPL-3.0-or-later
// https://github.com/buttonwood-protocol/button-wrappers/blob/main/contracts/UnbuttonToken.sol

pragma solidity ^0.7.0;

import { MockUnbuttonERC20 } from "@balancer-labs/v2-standalone-utils/contracts/test/MockUnbuttonERC20.sol";

import { IAToken } from "../interfaces/IAToken.sol";

contract MockAaveAMPLToken is MockUnbuttonERC20, IAToken {
     constructor(
        address underlying_,
        string memory name_,
        string memory symbol_
    ) MockUnbuttonERC20(underlying_, name_, symbol_) { }

    function UNDERLYING_ASSET_ADDRESS() external view override returns (address) {
        return _underlying;
    }
}
