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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IOmniVotingEscrowAdaptor.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IVotingEscrowRemapper.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

/**
 * @notice This contract allows veBAL holders on Ethereum to assign their balance to designated addresses on each L2.
 * This is intended for smart contracts that are not deployed to the same address on all networks. EOA's are
 * expected to either use the same address, or manage delegation on L2 networks themselves.
 *
 * @dev For each network (chainId), we maintain a mapping between local (Ethereum) and remote (L2) addresses.
 * This contract remaps balance queries on remote network addresses to their corresponding local addresses.
 * Users able to call this contract can set their own mappings, or delegate this function to another account if they
 * cannot.
 */
contract VotingEscrowRemapper is IVotingEscrowRemapper, SingletonAuthentication, ReentrancyGuard {
    IVotingEscrow private immutable _votingEscrow;
    IOmniVotingEscrowAdaptor private _omniVotingEscrowAdaptor;
    mapping(uint16 => mapping(address => address)) private _localToRemoteAddressMap;
    mapping(uint16 => mapping(address => address)) private _remoteToLocalAddressMap;

    // Records a mapping from an address to another address which is authorized to manage its remote users.
    mapping(address => address) private _localRemappingManager;

    constructor(
        IVault vault,
        IVotingEscrow votingEscrow,
        IOmniVotingEscrowAdaptor omniVotingEscrowAdaptor
    ) SingletonAuthentication(vault) {
        _votingEscrow = votingEscrow;
        _omniVotingEscrowAdaptor = omniVotingEscrowAdaptor;
    }

    /// @inheritdoc IVotingEscrowRemapper
    function getVotingEscrow() public view override returns (IVotingEscrow) {
        return _votingEscrow;
    }

    /// @inheritdoc IVotingEscrowRemapper
    function getOmniVotingEscrowAdaptor() public view override returns (IOmniVotingEscrowAdaptor) {
        return _omniVotingEscrowAdaptor;
    }

    /// @inheritdoc IVotingEscrowRemapper
    function getTotalSupplyPoint() external view override returns (IVotingEscrow.Point memory) {
        IVotingEscrow votingEscrow = getVotingEscrow();
        uint256 totalSupplyEpoch = votingEscrow.epoch();
        return votingEscrow.point_history(totalSupplyEpoch);
    }

    /// @inheritdoc IVotingEscrowRemapper
    function getUserPoint(address user) external view override returns (IVotingEscrow.Point memory) {
        IVotingEscrow votingEscrow = getVotingEscrow();
        uint256 userEpoch = votingEscrow.user_point_epoch(user);
        return votingEscrow.user_point_history(user, userEpoch);
    }

    /// @inheritdoc IVotingEscrowRemapper
    function getLockedEnd(address user) external view override returns (uint256) {
        return getVotingEscrow().locked__end(user);
    }

    /// @inheritdoc IVotingEscrowRemapper
    function getLocalUser(address remoteUser, uint16 chainId) public view override returns (address) {
        return _remoteToLocalAddressMap[chainId][remoteUser];
    }

    /// @inheritdoc IVotingEscrowRemapper
    function getRemoteUser(address localUser, uint16 chainId) public view override returns (address) {
        return _localToRemoteAddressMap[chainId][localUser];
    }

    /// @inheritdoc IVotingEscrowRemapper
    function getRemappingManager(address localUser) public view override returns (address) {
        return _localRemappingManager[localUser];
    }

    // Remapping Setters

    /// @inheritdoc IVotingEscrowRemapper
    function setNetworkRemapping(
        address localUser,
        address remoteUser,
        uint16 chainId
    ) external payable override nonReentrant {
        _require(msg.sender == localUser || msg.sender == _localRemappingManager[localUser], Errors.SENDER_NOT_ALLOWED);
        require(_isAllowedContract(localUser), "Only contracts which can hold veBAL can set up a mapping");
        require(remoteUser != address(0), "Zero address cannot be used as remote user");
        IOmniVotingEscrowAdaptor omniVotingEscrowAdaptor = getOmniVotingEscrowAdaptor();

        // We keep a 1-to-1 local-remote mapping for each chain.
        // If A --> B (i.e. A in the local chain is remapped to B in the remote chain), to keep the state consistent
        // the user effectively 'owns' both A and B in both chains.
        //
        // This means that whenever a new remapping is created (assuming A --> B previously):
        // - The remote address must not already be in use by another local user (C --> B is forbidden).
        // - The remote address must not be a local address that has already been remapped (C --> A is forbidden).
        // - The local address must not be the target remote address for another local user (B --> C is forbidden).
        //
        // Note that this means that it is possible to frontrun this call to grief a user by taking up their
        // selected remote address before they do so. This is mitigated somewhat by restricting potential attackers to
        // the set of contracts that are allowlisted to hold veBAL (and their remapping managers). Should
        // one of them grief, then Balancer governance can remove them from these allowlists.

        // B cannot be remapped to (i.e. be a remote) if a prior A --> B mapping exists.
        // To prevent it, we verify that the reverse mapping of our remote does not exist.
        require(
            _remoteToLocalAddressMap[chainId][remoteUser] == address(0),
            "Cannot overwrite an existing mapping by another user"
        );

        // A cannot be remapped to (i.e. be a remote) if a prior A --> B mapping exists.
        // To prevent it, we verify that the mapping of our remote does not exist.
        require(
            _localToRemoteAddressMap[chainId][remoteUser] == address(0),
            "Cannot remap to an address that is in use locally"
        );

        // B cannot be mapped from (i.e. be a local) if a prior A --> B mapping exists.
        // To prevent it, we verify that the reverse mapping of our local does not exist.
        require(
            _remoteToLocalAddressMap[chainId][localUser] == address(0),
            "Cannot remap to an address that is in use remotely"
        );

        // This is a best-effort check: we should not allow griefing the existing balance of an account,
        // because with this remapping we would overwrite it in the target chain ID.
        require(_votingEscrow.balanceOf(remoteUser) == 0, "Target remote address has non-zero veBAL balance");

        // Clear out the old remote user to avoid orphaned entries.
        address oldRemoteUser = _localToRemoteAddressMap[chainId][localUser];
        if (oldRemoteUser != address(0)) {
            _remoteToLocalAddressMap[chainId][oldRemoteUser] = address(0);
            emit RemoteAddressMappingCleared(oldRemoteUser, chainId);
        }

        // Set up new remapping.
        _remoteToLocalAddressMap[chainId][remoteUser] = localUser;
        _localToRemoteAddressMap[chainId][localUser] = remoteUser;

        emit AddressMappingUpdated(localUser, remoteUser, chainId);

        // Note: it is important to perform the bridge calls _after_ the mappings are settled, since the
        // omni voting escrow will rely on the correct mappings to bridge the balances.
        (uint256 nativeFee, ) = omniVotingEscrowAdaptor.estimateSendUserBalance(chainId);
        if (oldRemoteUser != address(0)) {
            require(msg.value >= nativeFee * 2, "Insufficient ETH to bridge user balance");
            // If there was an old mapping, send balance from (local) oldRemoteUser --> (remote) oldRemoteUser
            // This should clean up the existing bridged balance from localUser --> oldRemoteUser.
            omniVotingEscrowAdaptor.sendUserBalance{ value: nativeFee }(oldRemoteUser, chainId, payable(msg.sender));
        } else {
            require(msg.value >= nativeFee, "Insufficient ETH to bridge user balance");
        }

        // Bridge balance for new mapping localUser --> remoteUser.
        omniVotingEscrowAdaptor.sendUserBalance{ value: nativeFee }(localUser, chainId, payable(msg.sender));

        // Send back any leftover ETH to the caller.
        uint256 remainingBalance = address(this).balance;
        if (remainingBalance > 0) {
            Address.sendValue(msg.sender, remainingBalance);
        }
    }

    /// @inheritdoc IVotingEscrowRemapper
    function setNetworkRemappingManager(address localUser, address delegate)
        external
        override
        authenticate
        nonReentrant
    {
        require(_isAllowedContract(localUser), "Only contracts which can hold veBAL may have a delegate");

        _localRemappingManager[localUser] = delegate;
        emit AddressDelegateUpdated(localUser, delegate);
    }

    /// @inheritdoc IVotingEscrowRemapper
    function clearNetworkRemapping(address localUser, uint16 chainId) external payable override nonReentrant {
        require(localUser != address(0), "localUser cannot be zero address");
        require(!_isAllowedContract(localUser) || localUser == msg.sender, "localUser is still in good standing");
        IOmniVotingEscrowAdaptor omniVotingEscrowAdaptor = getOmniVotingEscrowAdaptor();

        address remoteUser = _localToRemoteAddressMap[chainId][localUser];
        require(remoteUser != address(0), "Remapping to clear does not exist");

        _remoteToLocalAddressMap[chainId][remoteUser] = address(0);
        _localToRemoteAddressMap[chainId][localUser] = address(0);

        emit AddressMappingUpdated(localUser, address(0), chainId);
        emit RemoteAddressMappingCleared(remoteUser, chainId);

        // Note: it is important to perform the bridge calls _after_ the mappings are settled, since the
        // omni voting escrow will rely on the correct mappings to bridge the balances.
        // Clean up the balance for the old mapping, and bridge the new (default) one.
        (uint256 nativeFee, ) = omniVotingEscrowAdaptor.estimateSendUserBalance(chainId);
        require(msg.value >= nativeFee * 2, "Insufficient ETH to bridge user balance");

        omniVotingEscrowAdaptor.sendUserBalance{ value: nativeFee }(localUser, chainId, payable(msg.sender));
        omniVotingEscrowAdaptor.sendUserBalance{ value: nativeFee }(remoteUser, chainId, payable(msg.sender));

        // Send back any leftover ETH to the caller.
        uint256 remainingBalance = address(this).balance;
        if (remainingBalance > 0) {
            Address.sendValue(msg.sender, remainingBalance);
        }
    }

    // Internal Functions

    /**
     * @notice Returns whether `localUser` is a contract which is authorized to hold veBAL.
     * @param localUser - The address to check against the `SmartWalletChecker`.
     */
    function _isAllowedContract(address localUser) private view returns (bool) {
        ISmartWalletChecker smartWalletChecker = getVotingEscrow().smart_wallet_checker();
        return smartWalletChecker.check(localUser);
    }
}
