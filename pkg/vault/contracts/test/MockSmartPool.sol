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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-asset-manager-utils/contracts/IAssetManager.sol";

import "../interfaces/IGeneralPool.sol";
import "../interfaces/IMinimalSwapInfoPool.sol";
import "../interfaces/IVault.sol";

import "hardhat/console.sol";

contract MockSmartPool is IGeneralPool, IMinimalSwapInfoPool {
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

       (amountsOut, dueProtocolFeeAmounts) = abi.decode(userData, (uint256[], uint256[]));


        (IERC20[] memory tokens,,) = this.getPoolTokes();
        for (uint i = 0; i < tokens.length; i++) {
           console.log("Token %s : %s", i, address(tokens[i]));
        }

        (uint256 cash, uint256 managed, uint256 lastChangeBlock, address assetManager) = this.getTokenInfo(tokens[0]);
        console.log("cash %s", cash);
        console.log("managed %s", managed);
        console.log("assetManager %s", assetManager);


        for (uint i = 0; i < amountsOut.length; i++) {
           console.log("amountsOut %s : %s", i, amountsOut[i]);
        }
        for (uint i = 0; i < dueProtocolFeeAmounts.length; i++) {
           console.log("dueProtocolFeeAmounts %s : %s", i, dueProtocolFeeAmounts[i]);
        }
        if (amountsOut[0] > cash){
            uint delta = amountsOut[0] - cash;
            console.log("delta %s", delta);
//            IAssetManager(assetManager).capitalOut(poolId, cashNeeded - cash);
            IAssetManager(assetManager).capitalOut(getPoolId(), delta);
        }

        emit OnExitPoolCalled(
            poolId,
            sender,
            recipient,
            currentBalances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

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
        console.log("onSwap1 called");

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
        console.log("onSwap2 called");

        return
            swapRequest.kind == IVault.SwapKind.GIVEN_IN
                ? swapRequest.amount.mulDown(_multiplier)
                : swapRequest.amount.divDown(_multiplier);
    }

    function setAssetManagerPoolConfig(address assetManager, bytes memory poolConfig) public {
        IAssetManager(assetManager).setConfig(getPoolId(), poolConfig);
    }

    function getTokenInfo(IERC20 token) external view returns (uint256 cash, uint256 managed, uint256 lastChangeBlock, address assetManager){
        return IVault(_vault).getPoolTokenInfo(getPoolId(), token);
    }


    function getPoolTokes() external view returns (IERC20[] memory tokens, uint256[] memory balances, uint256 lastChangeBlock){
        return IVault(_vault).getPoolTokens((getPoolId()));
    }



}
