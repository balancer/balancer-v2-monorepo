// SPDX-License-Identifier: GPL-3.0-or-later

import "./token/PropertiesBPTToken.sol";

pragma solidity ^0.7.1;

contract TestBPTTokenTransferable is PropertiesBPTToken {
    constructor () {
		initialTotalSupply = uint(-1);
        _mintPoolTokens(crytic_owner, initialTotalSupply/3); 
		initialBalance_owner = initialTotalSupply/3;
        _mintPoolTokens(crytic_user, initialTotalSupply/3); 
		initialBalance_user = initialTotalSupply/3;
        _mintPoolTokens(crytic_attacker, initialTotalSupply/3); 
		initialBalance_attacker = initialTotalSupply/3;
    }
}