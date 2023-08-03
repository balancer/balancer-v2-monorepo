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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "../StakelessGauge.sol";

/**
 * @dev Partial interface for LayerZero BAL proxy.
 */
interface ILayerZeroBALProxy {
    struct LzCallParams {
        address payable refundAddress;
        address zroPaymentAddress;
        bytes adapterParams;
    }

    /**
     * @dev Returns the address of the underlying ERC20 token.
     */
    function token() external view returns (address);

    /**
     * @dev Estimate send token `_tokenId` to (`_dstChainId`, `_toAddress`).
     * @param _dstChainId L0 defined chain id to send tokens to.
     * @param _toAddress dynamic bytes array which contains the address to whom you are sending tokens to on the
     *  dstChain.
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
     * @param _from the owner of token.
     * @param _dstChainId the destination chain identifier.
     * @param _toAddress can be any size depending on the `dstChainId`.
     * @param _amount the quantity of tokens in wei.
     * @param _minAmount the minimum amount of tokens to receive on dstChain.
     * @param _callParams struct with custom options.
     *  - refundAddress: the address LayerZero refunds if too much message fee is sent.
     *  - zroPaymentAddress set to address(0x0) if not paying in ZRO (LayerZero Token).
     *  - adapterParams is a flexible bytes array to indicate messaging adapter services.
     */
    function sendFrom(
        address _from,
        uint16 _dstChainId,
        bytes32 _toAddress,
        uint256 _amount,
        uint256 _minAmount,
        LzCallParams calldata _callParams
    ) external payable;

    /**
     * @dev Returns maximum allowed precision (decimals) for the proxy transfers.
     */
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

    ILayerZeroBALProxy private immutable _lzBALProxy;
    uint256 private immutable _dustModulo;

    // This value is kept in storage and not made immutable to allow for this contract to be proxyable
    address private _recipient;

    /**
     * @dev Must be deployed by the AvalancheRootGaugeFactory, or other contract that implements
     * `IAvalancheBridgeLimitsProvider`.
     */
    constructor(IMainnetBalancerMinter minter, ILayerZeroBALProxy lzBALProxy) StakelessGauge(minter) {
        _lzBALProxy = lzBALProxy;
        _dustModulo = 10**lzBALProxy.sharedDecimals();
    }

    function initialize(address recipient, uint256 relativeWeightCap) external {
        // Sanity check that the underlying token of the minter is the same we've wrapped for Avalanche.
        require(_lzBALProxy.token() == address(_balToken), "Invalid Wrapper Token");

        // This will revert in all calls except the first one
        __StakelessGauge_init(relativeWeightCap);

        _recipient = recipient;
    }

    /// @inheritdoc IStakelessGauge
    function getRecipient() external view override returns (address) {
        return _recipient;
    }

    /**
     * @dev Return the Layer Zero proxy contract for the underlying BAL token.
     */
    function getBALProxy() external view returns (address) {
        return address(_lzBALProxy);
    }

    function getTotalBridgeCost() public view returns (uint256) {
        // Estimate fee does not depend on the amount to bridge.
        // We just set it to 0 so that we can have the same external interface across other gauges that require ETH.
        (uint256 nativeFee, ) = _lzBALProxy.estimateSendFee(
            _AVALANCHE_LZ_CHAIN_ID,
            _bytes32Recipient(),
            0,
            false,
            "0x"
        );
        return nativeFee;
    }

    function _postMintAction(uint256 mintAmount) internal override {
        uint256 totalBridgeCost = getTotalBridgeCost();
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
            _bytes32Recipient(),
            mintAmount,
            _removeDust(mintAmount),
            ILayerZeroBALProxy.LzCallParams(payable(msg.sender), address(0), "0x")
        );
    }

    /**
     * @dev Truncates a given amount to the precision allowed by the shared decimals in the BAL proxy.
     */
    function _removeDust(uint256 amount) internal view returns (uint256) {
        uint256 dust = amount % _dustModulo;
        return amount - dust;
    }

    /**
     * @dev Returns recipient address as bytes32.
     */
    function _bytes32Recipient() internal view returns (bytes32) {
        return bytes32(uint256(uint160(_recipient)));
    }
}
