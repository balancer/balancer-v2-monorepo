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
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IGeneralPool.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IMinimalSwapInfoPool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

contract MockPool is IGeneralPool, IMinimalSwapInfoPool {
    using FixedPoint for uint256;

    IVault private immutable _vault;
    bytes32 private immutable _poolId;

    constructor(IVault vault, IVault.PoolSpecialization specialization) {
        _poolId = vault.registerPool(specialization);
        _vault = vault;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function getPoolId() public view override returns (bytes32) {
        return _poolId;
    }

    function getSwapFeePercentage() external pure override returns (uint256) {
        return 0;
    }

    function getScalingFactors() external pure override returns (uint256[] memory) {
        return new uint256[](0);
    }

    function registerTokens(IERC20[] memory tokens, address[] memory assetManagers) external {
        _vault.registerTokens(_poolId, tokens, assetManagers);
    }

    function deregisterTokens(IERC20[] memory tokens) external {
        _vault.deregisterTokens(_poolId, tokens);
    }

    event OnJoinPoolCalled(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] currentBalances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes userData
    );

    event OnExitPoolCalled(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] currentBalances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes userData
    );

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external override returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) {
        emit OnJoinPoolCalled(
            poolId,
            sender,
            recipient,
            currentBalances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        (amountsIn, dueProtocolFeeAmounts) = abi.decode(userData, (uint256[], uint256[]));
    }

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external override returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) {
        emit OnExitPoolCalled(
            poolId,
            sender,
            recipient,
            currentBalances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        (amountsOut, dueProtocolFeeAmounts) = abi.decode(userData, (uint256[], uint256[]));
    }

    // Amounts in are multiplied by the multiplier, amounts out are divided by it
    uint256 private _multiplier = FixedPoint.ONE;

    function setMultiplier(uint256 newMultiplier) external {
        _multiplier = newMultiplier;
    }

    // IGeneralPool
    function onSwap(
        SwapRequest memory swapRequest,
        uint256[] memory,
        uint256,
        uint256
    ) external view override returns (uint256 amount) {
        return
            swapRequest.kind == IVault.SwapKind.GIVEN_IN
                ? swapRequest.amount.mulDown(_multiplier)
                : swapRequest.amount.divDown(_multiplier);
    }

    // IMinimalSwapInfoPool
    function onSwap(
        SwapRequest memory swapRequest,
        uint256,
        uint256
    ) external view override returns (uint256) {
        return
            swapRequest.kind == IVault.SwapKind.GIVEN_IN
                ? swapRequest.amount.mulDown(_multiplier)
                : swapRequest.amount.divDown(_multiplier);
    }

    function queryJoin(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        bytes memory
    ) external pure override returns (uint256, uint256[] memory) {
        return (0, new uint256[](0));
    }

    function queryExit(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        bytes memory
    ) external pure override returns (uint256, uint256[] memory) {
        return (0, new uint256[](0));
    }
}
