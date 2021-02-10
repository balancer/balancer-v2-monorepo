// SPDX-License-Identifier: GPL-3.0-or-later

import "./interfaces.sol";
import "./scenarios/PropertiesJoinExit.sol";
import "./scenarios/PropertiesSwap.sol";
import "./scenarios/PropertiesStableMath.sol";
import "./scenarios/PropertiesPoolId.sol";

pragma solidity ^0.7.1;

contract TestScenario is CryticInterface, PropertiesJoinExit, PropertiesSwap, PropertiesStableMath, PropertiesPoolId{

}
