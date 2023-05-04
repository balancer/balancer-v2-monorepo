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
import "../vault/IVault.sol";

/**
 * @dev Interface for `OmniVotingEscrowAdaptor`.
 */
interface IOmniVotingEscrowAdaptor {
    /**
     * @notice Returns Omni Voting Escrow contract address, which is the gateway to bridge veBAL balances to L2s.
     */
    function getOmniVotingEscrow() external view returns (IOmniVotingEscrow);

    /**
     * @notice Forwards `estimateSendUserBalance` call to omni voting escrow.
     * @param _dstChainId - Destination chain ID.
     * @return nativeFee - Native fee reported by the omni voting escrow.
     * @return zroFee - Layer zero fee reported by the omni voting escrow.
     */
    function estimateSendUserBalance(uint16 _dstChainId) external view returns (uint256 nativeFee, uint256 zroFee);

    /**
     * @notice Forwards `sendUserBalance` call to omni voting escrow.
     * @param _user - User to bridge the balance from.
     * @param _dstChainId - Destination chain ID.
     * @param _refundAddress - Address where to return excess ETH.
     */
    function sendUserBalance(
        address _user,
        uint16 _dstChainId,
        address payable _refundAddress
    ) external payable;
}
