// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;

import "@balancer-labs/v2-interfaces/contracts/pool-weighted/IManagedPoolOwnerOnlyLib.sol";

contract ManagedPoolOwnerOnlyLib is IManagedPoolOwnerOnlyLib {
    bytes32 private immutable _actionIdDisambiguator;

    // The disambiguator for a pool will be the pool's factory
    constructor(address actionIdDisambiguator) {
        _actionIdDisambiguator = bytes32(uint256(actionIdDisambiguator));
    }

    function isOwnerOnlyAction(bytes32 actionId) external view override returns (bool) {
       return
            (actionId == getActionId(bytes4(keccak256(bytes("updateWeightsGradually(uint256,uint256,address[],uint256[]"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("updateSwapFeeGradually(uint256,uint256,uint256,uint256)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("setJoinExitEnabled(bool)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("setSwapEnabled(bool)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("addAllowedAddress(address)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("removeAllowedAddress(address)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("setMustAllowlistLPs(bool)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("addToken(address,address,uint256,uint256,address)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("removeToken(address,uint256,address)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("setManagementAumFeePercentage(uint256)"))))) ||
            (actionId == getActionId(bytes4(keccak256(bytes("setCircuitBreakers(address[],uint256[],uint256[],uint256[])")))));
    }

    function getActionId(bytes4 selector) private view returns (bytes32) {
        // Each external function is dynamically assigned an action identifier as the hash of the disambiguator and the
        // function selector. Disambiguation is necessary to avoid potential collisions in the function selectors of
        // multiple contracts.
        return keccak256(abi.encodePacked(_actionIdDisambiguator, selector));
    }
}