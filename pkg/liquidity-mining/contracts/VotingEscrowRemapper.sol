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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IVotingEscrow.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

/**
 * @notice This contract allows veBAL holders on Ethereum to designate an address on each L2 to receive its balance.
 * This is intended for smart contract systems where they cannot deploy to the same address on all networks, EOA's are
 * expected to utilise delegation mechanisms on the L2s themselves.
 *
 * @dev For each network (chainId) we maintain a mapping between Ethereum (local) and L2 (remote) addresses.
 * Queries for a balance of an address on a remote network are then remapped to the linked local address.
 * A local user can specify their own mapping or a delegate can be set up for them for the situation where the user
 * cannot call this contract.
 */
contract VotingEscrowRemapper is SingletonAuthentication {
    IVotingEscrow private immutable _votingEscrow;
    mapping(uint256 => mapping(address => address)) private _localToRemoteAddressMap;
    mapping(uint256 => mapping(address => address)) private _remoteToLocalAddressMap;

    // Records a mapping from an address to another address which is authorized to manage its remote users.
    mapping(address => address) private _localRemappingManager;

    event AddressMappingUpdated(address indexed localUser, address indexed remoteUser, uint256 indexed chainId);
    event AddressDelegateUpdated(address indexed localUser, address indexed delegate);

    constructor(IVotingEscrow votingEscrow, IVault vault) SingletonAuthentication(vault) {
        _votingEscrow = votingEscrow;
    }

    /**
     * @notice Allows querying the veBAL balance of an address on a remote chain.
     * @dev We return the user's balance as a Point to allow extrapolating this into the future.
     * @param remoteUser - Address of the user on the remote chain which are querying the balance for.
     * @param chainId - The chain ID of the network which this user is on.
     * @return The veBAL balance of `remoteUser` to be used on the specified network.
     */
    function getUserPointOnRemoteChain(address remoteUser, uint256 chainId)
        external
        view
        returns (IVotingEscrow.Point memory)
    {
        address localUser = getLocalUser(remoteUser, chainId);

        uint256 userEpoch = _votingEscrow.user_point_epoch(localUser);
        return _votingEscrow.user_point_history(localUser, userEpoch);
    }

    /**
     * @notice Returns the current total supply of veBAL as a Point.
     * @dev We return the total supply as a Point to allow extrapolating this into the future.
     */
    function getTotalSupplyPoint() external view returns (IVotingEscrow.Point memory) {
        uint256 totalSupplyEpoch = _votingEscrow.epoch();
        return _votingEscrow.point_history(totalSupplyEpoch);
    }

    /**
     * @notice Returns the local user corresponding to an address on a remote chain.
     * @param remoteUser - Address of the user on the remote chain which are querying the local address for.
     * @param chainId - The chain ID of the network which this user is on.
     */
    function getLocalUser(address remoteUser, uint256 chainId) public view returns (address) {
        address localUser = _remoteToLocalAddressMap[chainId][remoteUser];

        // If no remapping exists then we return the `remoteUser`'s address
        return localUser == address(0) ? remoteUser : localUser;
    }

    /**
     * @notice Returns the remote user corresponding to an address on the local chain.
     * @param localUser - Address of the user on the local chain which are querying the remote address for.
     * @param chainId - The chain ID of the network which the remote user is on.
     */
    function getRemoteUser(address localUser, uint256 chainId) public view returns (address) {
        address remoteUser = _localToRemoteAddressMap[chainId][localUser];

        // If no remapping exists then we return the `localUser`'s address
        return remoteUser == address(0) ? localUser : remoteUser;
    }

    function getRemappingManager(address localUser) public view returns (address) {
        return _localRemappingManager[localUser];
    }

    // Remapping Setters

    /**
     * @notice Sets up a mapping from `localUser`'s veBAL balance to `remoteUser` for chain `chainId`.
     * @dev In order to set up a remapping on this contract, `localUser` must be a smart contract which has been
     * allowlisted to hold veBAL. EOAs are expected to set up any delegation of their veBAL on L2s directly.
     * @param localUser - The address of a contract allowlisted on the `SmartWalletChecker`.
     * @param remoteUser - The address to receive `localUser`'s balance of veBAL on the remote chain.
     * @param chainId - The chain id of the remote chain on which `remoteUser` resides.
     */
    function setNetworkRemapping(
        address localUser,
        address remoteUser,
        uint256 chainId
    ) external {
        _require(msg.sender == localUser || msg.sender == _localRemappingManager[localUser], Errors.SENDER_NOT_ALLOWED);
        require(_isAllowedContract(localUser), "Only contracts which can hold veBAL can set up a mapping");

        // Prevent two local users pointing to the same remote user as this allows easy griefing attacks.
        //
        // Note that this still allows frontrunning attacks, this is mitigated by restricting potential attackers
        // to the set of contracts which are allowlisted to hold veBAL (and their delegates).
        // Should one of these entities grief, then Balancer governance can remove them from this allowlist.
        require(
            _remoteToLocalAddressMap[chainId][remoteUser] == address(0),
            "Cannot overwrite an existing mapping by another user"
        );

        // Clear out the old remote user to avoid orphaned entries.
        address oldRemoteUser = _localToRemoteAddressMap[chainId][localUser];
        _remoteToLocalAddressMap[chainId][oldRemoteUser] = address(0);

        // Set up new remapping.
        _remoteToLocalAddressMap[chainId][remoteUser] = localUser;
        _localToRemoteAddressMap[chainId][localUser] = remoteUser;

        emit AddressMappingUpdated(localUser, remoteUser, chainId);
    }

    /**
     * @notice Sets an address to manage the mapping for a given local user on its behalf.
     * @dev This is intended to handle contracts which cannot interact with this contract directly.
     * @param localUser - The address of a contract allowlisted on the `SmartWalletChecker`.
     * @param delegate - The address which is allowed to manage remote users to be linked to `localUser`.
     */
    function setNetworkRemappingManager(address localUser, address delegate) external authenticate {
        require(_isAllowedContract(localUser), "Only contracts which can hold veBAL may have a delegate");

        _localRemappingManager[localUser] = delegate;
        emit AddressDelegateUpdated(localUser, delegate);
    }

    /**
     * @notice Clears a local user's mapping for a particular network.
     * @dev This is intended to discourage and also allow recovery from griefing attacks.
     * If griefing occurs then the griefer can be removed from Smart Wallet Checker and have their remappings erased.
     * @param localUser - The address of the local user to erase.
     * @param chainId - The chain id of the network to erase.
     */
    function clearNetworkRemapping(address localUser, uint256 chainId) external {
        require(!_isAllowedContract(localUser), "localUser is still in good standing.");

        address remoteUser = _localToRemoteAddressMap[chainId][localUser];

        _remoteToLocalAddressMap[chainId][remoteUser] = address(0);
        _localToRemoteAddressMap[chainId][localUser] = address(0);
        _localRemappingManager[localUser] = address(0);

        emit AddressMappingUpdated(localUser, address(0), chainId);
        emit AddressDelegateUpdated(localUser, address(0));
    }

    // Internal Functions

    /**
     * @notice Returns whether `localUser` is a contract which is authorized to hold veBAL.
     * @param localUser - The address to check against the `SmartWalletChecker`.
     */
    function _isAllowedContract(address localUser) private view returns (bool) {
        ISmartWalletChecker smartWalletChecker = _votingEscrow.smart_wallet_checker();
        return smartWalletChecker.check(localUser);
    }
}
