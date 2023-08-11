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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./AvalancheRootGaugeLib.sol";
import "../StakelessGauge.sol";

/// @dev Partial interface for LayerZero BAL proxy.
interface ILayerZeroBALProxy {
    struct LzCallParams {
        address payable refundAddress;
        address zroPaymentAddress;
        bytes adapterParams;
    }

    /// @dev Returns packet type to be used in adapter params. It is a constant set to 0.
    // solhint-disable-next-line func-name-mixedcase
    function PT_SEND() external pure returns (uint8);

    /// @dev Returns minimum gas limit required for the target `chainId` and `packetType`.
    function minDstGasLookup(uint16 chainId, uint16 packetType) external view returns (uint256);

    /// @dev Returns true if custom adapter parameters are activated in the proxy.
    function useCustomAdapterParams() external view returns (bool);

    /// @dev Returns the address of the underlying ERC20 token.
    function token() external view returns (address);

    /**
     * @dev Estimate fee for sending token `_tokenId` to (`_dstChainId`, `_toAddress`).
     * @param _dstChainId L0 defined chain id to send tokens to.
     * @param _toAddress dynamic bytes array with the address you are sending tokens to on dstChain.
     * @param _amount amount of the tokens to transfer.
     * @param _useZro indicates to use zro to pay L0 fees.
     * @param _adapterParams flexible bytes array to indicate messaging adapter services in L0.
     */
    function estimateSendFee(
        uint16 _dstChainId,
        bytes32 _toAddress,
        uint256 _amount,
        bool _useZro,
        bytes calldata _adapterParams
    ) external view returns (uint256 nativeFee, uint256 zroFee);

    /**
     * @dev Send `_amount` amount of token to (`_dstChainId`, `_toAddress`) from `_from`.
     * @param _from the token owner.
     * @param _dstChainId the destination chain identifier.
     * @param _toAddress can be any size depending on the `dstChainId`.
     * @param _amount the quantity of tokens in wei.
     * @param _minAmount the minimum amount of tokens to receive on dstChain.
     * @param _callParams struct with custom options.
     *  - refundAddress: the address LayerZero refunds if too much message fee is sent.
     *  - zroPaymentAddress set to address(0x0) if not paying in ZRO (LayerZero Token).
     *  - adapterParams is a flexible bytes array used to configure messaging adapter services.
     */
    function sendFrom(
        address _from,
        uint16 _dstChainId,
        bytes32 _toAddress,
        uint256 _amount,
        uint256 _minAmount,
        LzCallParams calldata _callParams
    ) external payable;

    /// @dev Returns the maximum allowed precision (decimals) for proxy transfers.
    function sharedDecimals() external returns (uint8);
}

/**
 * @notice Root Gauge for the Avalanche network.
 * @dev Uses LayerZero OFTv2 (Omni Fungible Token V2) proxy contracts to bridge BAL.
 * See https://layerzero.gitbook.io/docs/evm-guides/layerzero-omnichain-contracts/oft/oftv2 for reference.
 */
contract AvalancheRootGauge is StakelessGauge {
    using SafeERC20 for IERC20;

    // LayerZero uses proprietary chain IDs.
    // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids#avalanche
    uint16 private constant _AVALANCHE_LZ_CHAIN_ID = 106;

    // PT_SEND constant in proxy; replicated here for simplicity.
    // See https://layerzero.gitbook.io/docs/evm-guides/layerzero-tooling/wire-up-configuration.
    // and https://github.com/LayerZero-Labs/solidity-examples/blob/9134640fe5b618a047f365555e760c8736ebc162/contracts/token/oft/v2/OFTCoreV2.sol#L17.
    // solhint-disable-previous-line max-line-length
    uint16 private constant _SEND_PACKET_TYPE = 0;

    // https://layerzero.gitbook.io/docs/evm-guides/advanced/relayer-adapter-parameters
    uint16 private constant _ADAPTER_PARAMS_VERSION = 1;

    ILayerZeroBALProxy private immutable _lzBALProxy;

    // The proxy will truncate the amounts to send using this value, as it does not support 18 decimals.
    // Any amount to send is truncated to this number, which depends on the shared decimals in the proxy.
    // See https://layerzero.gitbook.io/docs/evm-guides/layerzero-omnichain-contracts/oft/oft-v1-vs-oftv2-which-should-i-use#what-are-the-differences-between-the-two-versions
    // solhint-disable-previous-line max-line-length
    uint256 private immutable _minimumBridgeAmount;

    // This value is kept in storage and not made immutable to allow for this contract to be proxyable
    address private _recipient;

    /**
     * @dev Must be deployed by the AvalancheRootGaugeFactory, or other contract that implements
     * `IAvalancheBridgeLimitsProvider`.
     */
    constructor(IMainnetBalancerMinter minter, ILayerZeroBALProxy lzBALProxy) StakelessGauge(minter) {
        _lzBALProxy = lzBALProxy;
        uint8 decimalDifference = ERC20(address(minter.getBalancerToken())).decimals() - lzBALProxy.sharedDecimals();
        _minimumBridgeAmount = 10**decimalDifference;
    }

    function initialize(address recipient, uint256 relativeWeightCap) external {
        // Sanity check that the underlying token of the minter is the same we've wrapped for Avalanche.
        require(_lzBALProxy.token() == address(_balToken), "Invalid Wrapper Token");

        // This will revert in all calls except the first one
        __StakelessGauge_init(relativeWeightCap);

        _recipient = recipient;
    }

    /// @inheritdoc IStakelessGauge
    function getRecipient() public view override returns (address) {
        return _recipient;
    }

    /// @dev Return the Layer Zero proxy contract for the underlying BAL token.
    function getBALProxy() external view returns (address) {
        return address(_lzBALProxy);
    }

    /**
     * @dev Returns the minimum amount of tokens that can be bridged.
     * Values lower than this one will not even be transferred to the proxy.
     */
    function getMinimumBridgeAmount() public view returns (uint256) {
        return _minimumBridgeAmount;
    }

    /// @inheritdoc IStakelessGauge
    function getTotalBridgeCost() public view override returns (uint256) {
        return _getTotalBridgeCost(_getAdapterParams());
    }

    function _getTotalBridgeCost(bytes memory adapterParams) internal view returns (uint256) {
        // Estimate fee does not depend on the amount to bridge.
        // We just set it to 0 so that we can have the same external interface across other gauges that require ETH.
        (uint256 nativeFee, ) = _lzBALProxy.estimateSendFee(
            _AVALANCHE_LZ_CHAIN_ID,
            AvalancheRootGaugeLib.bytes32Recipient(getRecipient()),
            0,
            false,
            adapterParams
        );

        return nativeFee;
    }

    function _postMintAction(uint256 mintAmount) internal override {
        uint256 amountWithoutDust = AvalancheRootGaugeLib.removeDust(mintAmount, _minimumBridgeAmount);
        // If there is nothing to bridge, we return early.
        if (amountWithoutDust == 0) {
            return;
        }

        bytes memory adapterParams = _getAdapterParams();
        uint256 totalBridgeCost = _getTotalBridgeCost(adapterParams);

        require(msg.value == totalBridgeCost, "Incorrect msg.value passed");

        // The underlying token will be transferred, and must be approved.
        _balToken.safeApprove(address(_lzBALProxy), mintAmount);

        // Progress and results can be monitored using the Layer Zero scanner: https://layerzeroscan.com/
        // The BAL proxy uses less than 18 decimals, so any amount with greater precision than the supported one will
        // be truncated.
        // This is why we remove "dust" the same way the proxy does to provide an appropriate minimum amount and
        // ensure the transfer does not revert.
        // This assumes that there is no fee for the token, neither in the proxy (which can be set by governance, but
        // it is not expected to happen ever), nor for the token transfer itself (the BAL token does not take a cut
        // in `transferFrom`, so it is OK).
        _lzBALProxy.sendFrom{ value: totalBridgeCost }(
            address(this),
            _AVALANCHE_LZ_CHAIN_ID,
            AvalancheRootGaugeLib.bytes32Recipient(getRecipient()),
            mintAmount,
            amountWithoutDust,
            ILayerZeroBALProxy.LzCallParams(payable(msg.sender), address(0), adapterParams)
        );
    }

    function _getAdapterParams() internal view returns (bytes memory) {
        // Adapter params should either encode the minimum destination gas if custom parameters are used, or be
        // an empty bytes array otherwise.
        // See https://layerzero.gitbook.io/docs/evm-guides/advanced/relayer-adapter-parameters
        // These lines were reverse-engineered from the BAL proxy and its dependencies (LZ endpoint and relayer).

        // solhint-disable max-line-length
        // See https://github.com/LayerZero-Labs/LayerZero/blob/48c21c3921931798184367fc02d3a8132b041942/contracts/RelayerV2.sol#L104-L112
        // https://github.com/LayerZero-Labs/solidity-examples/blob/8e00603ae03995622d643722d6d194f830774208/contracts/token/oft/v2/OFTCoreV2.sol#L178-L179
        // https://github.com/LayerZero-Labs/solidity-examples/blob/8e00603ae03995622d643722d6d194f830774208/contracts/lzApp/LzApp.sol#L57-L58
        // solhint-enable max-line-length
        if (_lzBALProxy.useCustomAdapterParams()) {
            uint256 minDstGas = _lzBALProxy.minDstGasLookup(_AVALANCHE_LZ_CHAIN_ID, _SEND_PACKET_TYPE);
            return abi.encodePacked(_ADAPTER_PARAMS_VERSION, minDstGas);
        } else {
            return bytes("");
        }
    }
}
