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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IL2LayerZeroDelegation.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

/**
 * @notice Forwards calls from LayerZero's system to a custom hook whenever a veBAL balance is updated for a given user
 * in a L2 chain.
 * @dev The delegation contract can be set so that e.g. Child Chain Gauges are updated automatically whenever there is
 * a veBAL balance update.
 */
contract L2LayerZeroBridgeForwarder is IL2LayerZeroDelegation, SingletonAuthentication {
    event DelegationImplementationUpdated(IL2LayerZeroDelegation indexed newImplementation);

    IL2LayerZeroDelegation private _delegation;

    constructor(IVault vault) SingletonAuthentication(vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @notice Returns the current delegation implementation contract.
     */
    function getDelegationImplementation() external view returns (IL2LayerZeroDelegation) {
        return _delegation;
    }

    /**
     * @notice Hook to be called whenever the veBAL balance of a user is updated.
     */
    function onVeBalBridged(address user) external override {
        if (_delegation != IL2LayerZeroDelegation(0)) {
            _delegation.onVeBalBridged(user);
        }
    }

    /**
     * @notice Hook to be called whenever the veBAL supply is updated.
     */
    function onVeBalSupplyUpdate() external override {
        if (_delegation != IL2LayerZeroDelegation(0)) {
            _delegation.onVeBalSupplyUpdate();
        }
    }

    /**
     * @notice Sets a new delegation implementation for `onVeBalBridged`.
     */
    function setDelegation(IL2LayerZeroDelegation delegation) external authenticate {
        _delegation = delegation;

        emit DelegationImplementationUpdated(delegation);
    }
}
