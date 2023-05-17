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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "../StakelessGauge.sol";

interface IPolygonZkEVMBridge {
    function bridgeAsset(
        uint32 destinationNetwork,
        address destinationAddress,
        uint256 amount,
        address token,
        bool forceUpdateGlobalExitRoot,
        bytes calldata permitData
    ) external;
}

/**
 * @notice Root Gauge for the Polygon zkEVM network.
 * @dev Documentation is at https://zkevm.polygon.technology/docs/category/zkevm-bridge.
 */
contract PolygonZkEVMRootGauge is StakelessGauge {
    using SafeERC20 for IERC20;

    bool private constant _FORCE_UPDATE_GLOBAL_EXIT_ROOT = true;
    uint32 private constant _POLYGON_ZKEVM_NETWORK = 1;

    IPolygonZkEVMBridge private immutable _polygonZkEVMBridge;

    // This value is kept in storage and not made immutable to allow for this contract to be proxyable
    address private _recipient;

    constructor(IMainnetBalancerMinter minter, IPolygonZkEVMBridge polygonZkEVMBridge) StakelessGauge(minter) {
        _polygonZkEVMBridge = polygonZkEVMBridge;
    }

    function initialize(address recipient, uint256 relativeWeightCap) external {
        // This will revert in all calls except the first one
        __StakelessGauge_init(relativeWeightCap);

        _recipient = recipient;
    }

    function getRecipient() external view override returns (address) {
        return _recipient;
    }

    function getPolygonZkEVMBridge() external view returns (IPolygonZkEVMBridge) {
        return _polygonZkEVMBridge;
    }

    function _postMintAction(uint256 mintAmount) internal override {
        _balToken.safeApprove(address(_polygonZkEVMBridge), mintAmount);

        // This will transfer BAL to `_recipient` on the Polygon zkEVM chain
        // Emits a `BridgeEvent`.
        _polygonZkEVMBridge.bridgeAsset(
            _POLYGON_ZKEVM_NETWORK,
            _recipient,
            mintAmount,
            address(_balToken),
            _FORCE_UPDATE_GLOBAL_EXIT_ROOT,
            ""
        );
    }
}
