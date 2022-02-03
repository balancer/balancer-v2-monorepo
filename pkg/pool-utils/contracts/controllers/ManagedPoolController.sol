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
pragma experimental ABIEncoderV2;

import "../interfaces/IControlledManagedPool.sol";
import "./BasePoolController.sol";

/**
 * @dev Pool controller that serves as the "owner" of a Managed pool, and is in turn owned by
 * an account empowered to make calls on this contract, which are forwarded to the underlyling pool.
 *
 * This contract can place limits on whether and how these calls can be made. For instance,
 * imposing a minimum gradual weight change duration.
 *
 * While Balancer pool owners are immutable, ownership of this pool controller can be transferrable,
 * if the corresponding permission is set.
 */
contract ManagedPoolController is BasePoolController, IControlledManagedPool {
    using WordCodec for bytes32;

    // There are six managed pool rights: all corresponding to permissioned functions of ManagedPool.
    struct ManagedPoolRights {
        bool canChangeWeights;
        bool canDisableSwaps;
        bool canSetMustAllowlistLPs;
        bool canSetCircuitBreakers;
        bool canChangeTokens;
        bool canChangeMgmtSwapFee;
    }

    // The minimum weight change duration could be replaced with more sophisticated rate-limiting.
    uint256 internal immutable _minWeightChangeDuration;

    // Immutable controller state - the first 16 bits are reserved as a bitmap for permission flags
    // (3 used in the base class; 6 used here), and the remaining 240 bits can be used by derived classes
    // to store any other immutable data.
    //
    //               Managed Pool Controller Permissions             |   Base Controller Permissions  ]
    // [  240 | 7 bits |   1 bit  |  1 bit |  1 bit   | 1 bit | 1 bit |  1 bit  |  1 bit   |  1 bit   |   1 bit  ]
    // [unused|reserved| mgmt fee | tokens | breakers |  LPs  | swaps | weights | metadata | swap fee | transfer ]
    // |MSB                                                                                                   LSB|

    uint256 private constant _CHANGE_WEIGHTS_OFFSET = 3;
    uint256 private constant _DISABLE_SWAPS_OFFSET = 4;
    uint256 private constant _MUST_ALLOWLIST_LPS_OFFSET = 5;
    uint256 private constant _CIRCUIT_BREAKERS_OFFSET = 6;
    uint256 private constant _CHANGE_TOKENS_OFFSET = 7;
    uint256 private constant _CHANGE_MGMT_SWAP_FEE_OFFSET = 8;

    /**
     * @dev Pass in the `BasePoolRights` and `ManagedPoolRights` structures, to form the complete set of
     * immutable rights. Then pass any parameters related to restrictions on those rights. For instance,
     * a minimum duration if changing weights is enabled.
     */
    constructor(
        BasePoolRights memory baseRights,
        ManagedPoolRights memory managedRights,
        uint256 minWeightChangeDuration,
        address manager
    ) BasePoolController(encodePermissions(baseRights, managedRights), manager) {
        _minWeightChangeDuration = minWeightChangeDuration;
    }

    function encodePermissions(BasePoolRights memory baseRights, ManagedPoolRights memory managedRights)
        public
        pure
        returns (bytes32)
    {
        bytes32 permissions = super
            .encodePermissions(baseRights)
            .insertBool(managedRights.canChangeWeights, _CHANGE_WEIGHTS_OFFSET)
            .insertBool(managedRights.canDisableSwaps, _DISABLE_SWAPS_OFFSET)
            .insertBool(managedRights.canSetMustAllowlistLPs, _MUST_ALLOWLIST_LPS_OFFSET);

        // Needed to avoid "stack too deep"
        return
            permissions
                .insertBool(managedRights.canChangeMgmtSwapFee, _CHANGE_MGMT_SWAP_FEE_OFFSET)
                .insertBool(managedRights.canChangeTokens, _CHANGE_TOKENS_OFFSET)
                .insertBool(managedRights.canSetCircuitBreakers, _CIRCUIT_BREAKERS_OFFSET);
    }

    /**
     * @dev Getter for the canChangeWeights permission.
     */
    function canChangeWeights() public view returns (bool) {
        return _controllerState.decodeBool(_CHANGE_WEIGHTS_OFFSET);
    }

    /**
     * @dev Getter for the canDisableSwaps permission.
     */
    function canDisableSwaps() public view returns (bool) {
        return _controllerState.decodeBool(_DISABLE_SWAPS_OFFSET);
    }

    /**
     * @dev Getter for the mustAllowlistLPs permission.
     */
    function canSetMustAllowlistLPs() public view returns (bool) {
        return _controllerState.decodeBool(_MUST_ALLOWLIST_LPS_OFFSET);
    }

    /**
     * @dev Getter for the canSetCircuitBreakers permission.
     */
    function canSetCircuitBreakers() public view returns (bool) {
        return _controllerState.decodeBool(_CIRCUIT_BREAKERS_OFFSET);
    }

    /**
     * @dev Getter for the canChangeTokens permission.
     */
    function canChangeTokens() public view returns (bool) {
        return _controllerState.decodeBool(_CHANGE_TOKENS_OFFSET);
    }

    /**
     * @dev Getter for the canChangeManagementSwapFeePercentage permission.
     */
    function canChangeManagementSwapFeePercentage() public view returns (bool) {
        return _controllerState.decodeBool(_CHANGE_MGMT_SWAP_FEE_OFFSET);
    }

    /**
     * @dev Getter for the minimum weight change duration.
     */
    function getMinWeightChangeDuration() external view returns (uint256) {
        return _minWeightChangeDuration;
    }

    /**
     * @dev Update weights linearly from the current values to the given end weights, between startTime
     * and endTime.
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] calldata endWeights
    ) external virtual override onlyManager withBoundPool {
        _require(canChangeWeights(), Errors.UNAUTHORIZED_OPERATION);
        _require(
            endTime >= startTime && endTime - startTime >= _minWeightChangeDuration,
            Errors.WEIGHT_CHANGE_TOO_FAST
        );

        IControlledManagedPool(pool).updateWeightsGradually(startTime, endTime, endWeights);
    }

    /**
     * @dev Pass a call to ManagedPool's setSwapEnabled through to the underlying pool.
     */
    function setSwapEnabled(bool swapEnabled) external virtual override onlyManager withBoundPool {
        _require(canDisableSwaps(), Errors.UNAUTHORIZED_OPERATION);

        IControlledManagedPool(pool).setSwapEnabled(swapEnabled);
    }

    /**
     * @dev Pass a call to ManagedPool's setMustAllowlistLPs through to the underlying pool. This could
     * be restricted in various ways. For instance, we could allow it to change state only once, or only
     * in one direction, but there seems to be no compelling reason to do so in the reference controller.
     *
     * Deploying a Managed Pool with an empty allowlist could function like an LBP, or a smart treasury.
     * Adding a set of addresses to the allowlist enables multiple seed funding sources. Disabling the
     * allowlist, or re-enabling it after allowing public LPs, can impose or remove a "cap" on the total supply.
     */
    function setMustAllowlistLPs(bool mustAllowlistLPs) external virtual override onlyManager withBoundPool {
        _require(canSetMustAllowlistLPs(), Errors.UNAUTHORIZED_OPERATION);

        IControlledManagedPool(pool).setMustAllowlistLPs(mustAllowlistLPs);
    }

    /**
     * @dev Pass a call to ManagedPool's addAllowedAddress through to the underlying pool.
     * The underlying pool handles all state/permission checks. It will revert if the LP allowlist is off.
     */
    function addAllowedAddress(address member) external virtual override onlyManager withBoundPool {
        IControlledManagedPool(pool).addAllowedAddress(member);
    }

    /**
     * @dev Pass a call to ManagedPool's removeAllowedAddress through to the underlying pool.
     * The underlying pool handles all state/permission checks. It will revert if the address was not
     * previouslly added to the allowlist.
     */
    function removeAllowedAddress(address member) external virtual override onlyManager withBoundPool {
        IControlledManagedPool(pool).removeAllowedAddress(member);
    }

    /**
     * @dev Pass a call to ManagedPool's withdrawCollectedManagementFees through to the underlying pool.
     */
    function withdrawCollectedManagementFees(address recipient) external virtual override onlyManager withBoundPool {
        IControlledManagedPool(pool).withdrawCollectedManagementFees(recipient);
    }

    /**
     * @dev Pass a call to ManagedPool's setManagementSwapFeePercentage through to the underlying pool.
     */
    function setManagementSwapFeePercentage(uint256 managementSwapFeePercentage)
        external
        virtual
        override
        onlyManager
        withBoundPool
    {
        _require(canChangeManagementSwapFeePercentage(), Errors.UNAUTHORIZED_OPERATION);

        IControlledManagedPool(pool).setManagementSwapFeePercentage(managementSwapFeePercentage);
    }
}
