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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IBasePoolController.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../BasePoolAuthorization.sol";

/**
 * @dev Pool controller that serves as the owner of a Balancer pool, and is in turn owned by
 * an account empowered to make calls on this contract, which are forwarded to the underlyling pool.
 *
 * While the owner of the underlying Balancer pool is immutable, ownership of this pool controller
 * can be transferred, if the corresponding permission is set to allow this operation. To prevent
 * accidentally setting the manager to an invalid address (and irrevocably losing control of the pool),
 * transferring ownership is a two-step process.
 *
 * If the changeSwapFee permission is enabled, the manager can call setSwapFeePercentage, or delegate
 * this right to a different address.
 */
contract BasePoolController is IBasePoolController {
    using WordCodec for bytes32;

    // There are three basic pool rights: one for transferring ownership, one for changing the swap fee,
    // and the last for associating arbitrary metadata with the pool. The remaining BasePool privileged
    // function (setAssetManagerPoolConfig) has no associated permission. It doesn't make sense to
    // restrict that, as a fixed configuration would prevent rebalancing and potentially lead to loss
    // of funds.
    struct BasePoolRights {
        bool canTransferOwnership;
        bool canChangeSwapFee;
        bool canUpdateMetadata;
    }

    // The address empowered to call permissioned functions.
    address private _manager;

    // Target of a proposed transfer of ownership. Will be non-zero if there is a transfer pending.
    // This address must call claimOwnership to complete the transfer.
    address private _managerCandidate;

    // Address allowed to call `setSwapFeePercentage`. Initially set to the owner (or 0 if fees are fixed)
    address private _swapFeeController;

    // Address of the underlying pool.
    address public pool;

    // Immutable controller state - the first 16 bits are reserved as a bitmap for permission flags
    // (3 used in this base class), and the remaining 240 bits can be used by derived classes to store
    // any other immutable data.
    //
    // [          |         16 bits for permission flags      ]
    // [ 240 bits |  13 bits |  1 bit   |  1 bit   |   1 bit  ]
    // [  unused  | reserved | metadata | swap fee | transfer ]
    // |MSB                                                LSB|
    bytes32 internal immutable _controllerState;

    uint256 private constant _TRANSFER_OWNERSHIP_OFFSET = 0;
    uint256 private constant _CHANGE_SWAP_FEE_OFFSET = 1;
    uint256 private constant _UPDATE_METADATA_OFFSET = 2;

    // Optional metadata associated with this controller (or the pool bound to it)
    bytes private _metadata;

    // Event declarations

    event OwnershipTransferred(address indexed previousManager, address indexed newManager);
    event SwapFeeControllerChanged(address indexed oldSwapFeeController, address indexed newSwapFeeController);
    event MetadataUpdated(bytes metadata);

    // Modifiers

    // Add this modifier to all functions that call the underlying pool.
    modifier withBoundPool {
        _ensurePoolIsBound();
        _;
    }

    /**
     * @dev Reverts if called by any account other than the manager.
     */
    modifier onlyManager() {
        _require(getManager() == msg.sender, Errors.CALLER_IS_NOT_OWNER);
        _;
    }

    /**
     * @dev Set permissions and the initial manager for the pool controller. We are "trusting" the manager to be
     * a valid address on deployment, as does BasePool. Transferring ownership to a new manager after deployment
     * employs a safe, two-step process.
     */
    constructor(bytes32 controllerState, address manager) {
        _controllerState = controllerState;
        _manager = manager;

        // If the swap fee is not fixed, it can be delegated (initially, to the manager).
        if (controllerState.decodeBool(_CHANGE_SWAP_FEE_OFFSET)) {
            _swapFeeController = manager;
        }
    }

    /**
     * @dev Encode the BaseController portion of the controllerState. This is mainly useful for
     * derived classes to call during construction.
     */
    function encodePermissions(BasePoolRights memory rights) public pure returns (bytes32) {
        bytes32 permissions;

        return
            permissions
                .insertBool(rights.canTransferOwnership, _TRANSFER_OWNERSHIP_OFFSET)
                .insertBool(rights.canChangeSwapFee, _CHANGE_SWAP_FEE_OFFSET)
                .insertBool(rights.canUpdateMetadata, _UPDATE_METADATA_OFFSET);
    }

    /**
     * @dev Getter for the current manager.
     */
    function getManager() public view returns (address) {
        return _manager;
    }

    /**
     * @dev Returns the manager candidate, which will be non-zero if there is a pending ownership transfer.
     */
    function getManagerCandidate() external view returns (address) {
        return _managerCandidate;
    }

    /**
     * @dev Getter for the current swap fee controller (0 if fees are fixed).
     */
    function getSwapFeeController() public view returns (address) {
        return _swapFeeController;
    }

    /**
     * @dev Getter for the transferOwnership permission.
     */
    function canTransferOwnership() public view returns (bool) {
        return _controllerState.decodeBool(_TRANSFER_OWNERSHIP_OFFSET);
    }

    /**
     * @dev Getter for the canChangeSwapFee permission.
     */
    function canChangeSwapFee() public view returns (bool) {
        return _controllerState.decodeBool(_CHANGE_SWAP_FEE_OFFSET);
    }

    /**
     * @dev Getter for the canUpdateMetadata permission.
     */
    function canUpdateMetadata() public view returns (bool) {
        return _controllerState.decodeBool(_UPDATE_METADATA_OFFSET);
    }

    /**
     * @dev The underlying pool owner is immutable, so its address must be known when the pool is deployed.
     * This means the controller needs to be deployed first. Yet the controller also needs to know the address
     * of the pool it is controlling.
     *
     * We could either pass in a pool factory and have the controller deploy the pool, or have an initialize
     * function to set the pool address after deployment. This decoupled mechanism seems cleaner.
     *
     * It means the pool address must be in storage vs immutable, but this is acceptable for infrequent admin
     * operations.
     */
    function initialize(address poolAddress) public virtual override {
        // This can only be called once - and the owner of the pool must be this contract
        _require(
            pool == address(0) && BasePoolAuthorization(poolAddress).getOwner() == address(this),
            Errors.INVALID_INITIALIZATION
        );

        pool = poolAddress;
    }

    /**
     * @dev Stores the proposed new manager in `_managerCandidate`. To prevent accidental transfer to an invalid
     * address, the candidate address must call `claimOwnership` to complete the transfer.
     *
     * Can only be called by the current manager.
     */
    function transferOwnership(address newManager) external onlyManager {
        _require(canTransferOwnership(), Errors.FEATURE_DISABLED);

        _managerCandidate = newManager;
    }

    /**
     * @dev This must be called by the manager candidate to complete the transferwnership operation.
     * This "claimable" mechanism prevents accidental transfer of ownership to an invalid address.
     *
     * To keep this function simple and focused, transferring ownership does not affect the swapFeeController.
     * Sometimes the new owner might want to retain the "old" swap fee controller (e.g., if it was
     * delegated to Gauntlet). Other times an owner may want to take control of fees from the previous
     * owner. In the latter case, the new owner should call `setSwapFeeController`.
     */
    function claimOwnership() external {
        address candidate = _managerCandidate;

        _require(candidate == msg.sender, Errors.SENDER_NOT_ALLOWED);

        emit OwnershipTransferred(_manager, candidate);
        _manager = candidate;

        // Setting the candidate to zero prevents calling this repeatedly and generating multiple redundant events,
        // and also allows checking (perhaps by a UI) whether there is a pending transfer.
        _managerCandidate = address(0);
    }

    /**
     * @dev Change the address allowed to call setSwapFeePercentage.
     */
    function setSwapFeeController(address newSwapFeeController) external onlyManager {
        emit SwapFeeControllerChanged(getSwapFeeController(), newSwapFeeController);

        _swapFeeController = newSwapFeeController;
    }

    /**
     * @dev Pass a call to BasePool's setSwapFeePercentage through to the underlying pool, if allowed.
     */
    function setSwapFeePercentage(uint256 swapFeePercentage) external virtual override withBoundPool {
        _require(canChangeSwapFee(), Errors.FEATURE_DISABLED);
        _require(getSwapFeeController() == msg.sender, Errors.SENDER_NOT_ALLOWED);

        IControlledPool(pool).setSwapFeePercentage(swapFeePercentage);
    }

    /**
     * @dev Pass a call to BasePool's setAssetManagerPoolConfig through to the underlying pool. This does not
     * need to be permissioned: any pool with asset managers must allow the owner to configure them.
     */
    function setAssetManagerPoolConfig(IERC20 token, bytes memory poolConfig)
        external
        virtual
        override
        onlyManager
        withBoundPool
    {
        IControlledPool(pool).setAssetManagerPoolConfig(token, poolConfig);
    }

    /**
     * @dev Getter for the optional metadata.
     */
    function getMetadata() public view returns (bytes memory) {
        return _metadata;
    }

    /**
     * @dev Setter for the admin to set/update the metadata
     */
    function updateMetadata(bytes memory metadata) external onlyManager {
        _require(canUpdateMetadata(), Errors.FEATURE_DISABLED);

        _metadata = metadata;
        emit MetadataUpdated(metadata);
    }

    function _ensurePoolIsBound() private view {
        _require(pool != address(0), Errors.UNINITIALIZED_POOL_CONTROLLER);
    }
}
