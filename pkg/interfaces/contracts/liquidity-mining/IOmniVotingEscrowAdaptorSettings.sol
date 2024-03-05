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

pragma solidity >=0.7.0 <0.9.0;

import "./IOmniVotingEscrow.sol";

/**
 * @dev Interface for `OmniVotingEscrowAdaptor` settings.
 */
interface IOmniVotingEscrowAdaptorSettings {
    event OmniVotingEscrowUpdated(IOmniVotingEscrow indexed newOmniVotingEscrow);
    event UseZeroUpdated(bool newUseZero);
    event AdapterParamsUpdated(bytes newAdapterParams);
    event ZeroPaymentAddressUpdated(address indexed newZeroPaymentAddress);

    /**
     * @notice Returns Omni Voting Escrow contract address, which is the gateway to bridge veBAL balances to L2s.
     */
    function getOmniVotingEscrow() external view returns (IOmniVotingEscrow);

    /**
     * @notice Returns `_useZro` parameter used in `estimateSendUserBalance`.
     */
    function getUseZero() external view returns (bool);

    /**
     * @notice Returns `_adapterParams` parameter used in `estimateSendUserBalance` and `sendUserBalance`.
     */
    function getAdapterParams() external view returns (bytes memory);

    /**
     * @notice Returns `_zroPaymentAddress` parameter used in `sendUserBalance`.
     */
    function getZeroPaymentAddress() external view returns (address);

    /**
     * @notice Sets omni voting escrow address.
     * @dev This step is required before creating any remapping in the `VotingEscrowRemapper`.
     * Omni voting escrow is not set in the constructor to avoid circular dependencies.
     * Emits `OmniVotingEscrowUpdated` event.
     * @param omniVotingEscrow - Address of the omni voting escrow contract.
     */
    function setOmniVotingEscrow(IOmniVotingEscrow omniVotingEscrow) external;

    /**
     * @notice Sets `_useZro` parameter for `estimateSendUserBalance` when forwarding calls.
     * @dev Emits `UseZeroUpdated` event.
     */
    function setUseZero(bool useZro) external;

    /**
     * @notice Sets `_adapterParams` parameter for `estimateSendUserBalance` and `sendUserBalance` when forwarding
     * calls.
     * @dev Emits `AdapterParamsUpdated` event.
     */
    function setAdapterParams(bytes memory adapterParams) external;

    /**
     * @notice Sets `_zroPaymentAddress` parameter for `sendUserBalance` when forwarding calls.
     * @dev Emits `ZeroPaymentAddressUpdated` event.
     */
    function setZeroPaymentAddress(address paymentAddress) external;
}
