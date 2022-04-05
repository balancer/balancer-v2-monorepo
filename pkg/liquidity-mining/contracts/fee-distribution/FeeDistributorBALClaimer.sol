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

import "@balancer-labs/v2-standalone-utils/contracts/interfaces/IBALTokenHolder.sol";

import "../interfaces/IFeeDistributor.sol";
import "../interfaces/ISingleRecipientGauge.sol";

/**
 * @title FeeDistributorBALClaimer
 * @notice Atomically mints any outstanding BAL from a SingleRecipientGauge and transfers it to the FeeDistributor
 * in order for it to be distributed among veBAL holders.
 */
contract FeeDistributorBALClaimer {
    IERC20 private immutable _balToken;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    IFeeDistributor private immutable _feeDistributor;
    ISingleRecipientGauge private immutable _gauge;
    IBALTokenHolder private immutable _balTokenHolder;

    constructor(
        IFeeDistributor feeDistributor,
        ISingleRecipientGauge gauge,
        IAuthorizerAdaptor authorizerAdaptor
    ) {
        IBALTokenHolder balTokenHolder = IBALTokenHolder(gauge.getRecipient());

        _balToken = balTokenHolder.getBalancerToken();
        _authorizerAdaptor = authorizerAdaptor;
        _feeDistributor = feeDistributor;
        _gauge = gauge;
        _balTokenHolder = balTokenHolder;
    }

    /**
     * @notice Returns the address of the Balancer token contract.
     */
    function getBalancerToken() external view returns (IERC20) {
        return _balToken;
    }

    /**
     * @notice Returns the address of the AuthorizerAdaptor contract.
     */
    function getAuthorizerAdaptor() external view returns (IAuthorizerAdaptor) {
        return _authorizerAdaptor;
    }

    /**
     * @notice Returns the address of the FeeDistributor contract.
     */
    function getFeeDistributor() external view returns (IFeeDistributor) {
        return _feeDistributor;
    }

    /**
     * @notice Returns the address of the associated SingleRecipientGauge contract.
     */
    function getGauge() external view returns (ISingleRecipientGauge) {
        return _gauge;
    }

    /**
     * @notice Returns the address of the associated BALTokenHolder contract.
     */
    function getBALTokenHolder() external view returns (IBALTokenHolder) {
        return _balTokenHolder;
    }

    /**
     * @notice Mint any outstanding BAL emissions and send them to the FeeDistributor
     * @dev In order to call this function the `FeeDistributorBALClaimer` must be authorized to:
     * - Withdraw BAL from the linked BALTokenHolder
     * - Checkpoint the associated SingleRecipientGauge in order to mint BAL.
     */
    function distributeBAL() external {
        _checkpointGauge(_gauge);
        _balTokenHolder.withdrawFunds(address(_feeDistributor), _balToken.balanceOf(address(_balTokenHolder)));
        _feeDistributor.checkpointToken(_balToken);
    }

    function _checkpointGauge(IStakelessGauge gauge) private {
        _authorizerAdaptor.performAction(address(gauge), abi.encodeWithSelector(IStakelessGauge.checkpoint.selector));
    }
}
