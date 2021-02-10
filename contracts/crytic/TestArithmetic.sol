// SPDX-License-Identifier: GPL-3.0-or-later

import "./arithmetic/TBFixedPoint256.sol";
import "./arithmetic/TBLogExpMath.sol";

pragma solidity ^0.7.1;

contract TestArithmetic is TBFixedPoint256, TBLogExpMath{
    constructor() {
    }
}