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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IOmniVotingEscrow.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IOmniVotingEscrowAdaptor.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IOmniVotingEscrowAdaptorSettings.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

/**
 * @notice Adaptor contract between `VotingEscrowRemapper` and `OmniVotingEscrow`.
 * @dev Provides the remapper a stable interface to forward requests to the omni voting escrow, while allowing to
 * configure optional parameters and even swap the target omni voting escrow contract.
 */
contract OmniVotingEscrowAdaptor is
    IOmniVotingEscrowAdaptor,
    IOmniVotingEscrowAdaptorSettings,
    SingletonAuthentication
{
    IOmniVotingEscrow private _omniVotingEscrow;
    bool private _useZro;
    bytes private _adapterParams;
    address private _zroPaymentAddress;

    constructor(IVault vault) SingletonAuthentication(vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /// @inheritdoc IOmniVotingEscrowAdaptorSettings
    function getOmniVotingEscrow() public view override returns (IOmniVotingEscrow) {
        return _omniVotingEscrow;
    }

    /// @inheritdoc IOmniVotingEscrowAdaptorSettings
    function getUseZero() external view override returns (bool) {
        return _useZro;
    }

    /// @inheritdoc IOmniVotingEscrowAdaptorSettings
    function getAdapterParams() external view override returns (bytes memory) {
        return _adapterParams;
    }

    /// @inheritdoc IOmniVotingEscrowAdaptorSettings
    function getZeroPaymentAddress() external view override returns (address) {
        return _zroPaymentAddress;
    }

    /// @inheritdoc IOmniVotingEscrowAdaptor
    function estimateSendUserBalance(uint16 _dstChainId)
        external
        view
        override
        returns (uint256 nativeFee, uint256 zroFee)
    {
        IOmniVotingEscrow omniVotingEscrow = getOmniVotingEscrow();
        require(omniVotingEscrow != IOmniVotingEscrow(0), "Omni voting escrow not set");

        return omniVotingEscrow.estimateSendUserBalance(_dstChainId, _useZro, _adapterParams);
    }

    /// @inheritdoc IOmniVotingEscrowAdaptor
    function sendUserBalance(
        address _user,
        uint16 _dstChainId,
        address payable _refundAddress
    ) external payable override {
        IOmniVotingEscrow omniVotingEscrow = getOmniVotingEscrow();
        require(omniVotingEscrow != IOmniVotingEscrow(0), "Omni voting escrow not set");

        omniVotingEscrow.sendUserBalance{ value: msg.value }(
            _user,
            _dstChainId,
            _refundAddress,
            _zroPaymentAddress,
            _adapterParams
        );
    }

    /// @inheritdoc IOmniVotingEscrowAdaptorSettings
    function setOmniVotingEscrow(IOmniVotingEscrow omniVotingEscrow) external override authenticate {
        _omniVotingEscrow = omniVotingEscrow;
        emit OmniVotingEscrowUpdated(omniVotingEscrow);
    }

    /// @inheritdoc IOmniVotingEscrowAdaptorSettings
    function setUseZero(bool useZro) external override authenticate {
        _useZro = useZro;
        emit UseZeroUpdated(useZro);
    }

    /// @inheritdoc IOmniVotingEscrowAdaptorSettings
    function setAdapterParams(bytes memory adapterParams) external override authenticate {
        _adapterParams = adapterParams;
        emit AdapterParamsUpdated(adapterParams);
    }

    /// @inheritdoc IOmniVotingEscrowAdaptorSettings
    function setZeroPaymentAddress(address paymentAddress) external override authenticate {
        _zroPaymentAddress = paymentAddress;
        emit ZeroPaymentAddressUpdated(paymentAddress);
    }
}
