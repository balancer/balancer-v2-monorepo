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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../vault/interfaces/IVault.sol";
import "../vault/interfaces/IPool.sol";
import "../vault/interfaces/IGeneralPoolQuote.sol";
import "../vault/interfaces/IMinimalSwapInfoPoolQuote.sol";

import "../math/FixedPoint.sol";

contract MockPool is IPool, IGeneralPoolQuote, IMinimalSwapInfoPoolQuote {
    using FixedPoint for uint256;

    IVault private immutable _vault;
    bytes32 private immutable _poolId;

    constructor(IVault vault, IVault.PoolSpecialization specialization) {
        _poolId = vault.registerPool(specialization);
        _vault = vault;
    }

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function registerTokens(IERC20[] memory tokens, address[] memory assetManagers) external {
        _vault.registerTokens(_poolId, tokens, assetManagers);
    }

    function unregisterTokens(IERC20[] memory tokens) external {
        _vault.unregisterTokens(_poolId, tokens);
    }

    uint256[] private _onJoinExitPoolAmounts;
    uint256[] private _onJoinPoolDueProtocolFeeAmounts;

    function setOnJoinExitPoolReturnValues(uint256[] memory amounts, uint256[] memory dueProtocolFeeAmounts) external {
        delete _onJoinExitPoolAmounts;
        for (uint256 i = 0; i < amounts.length; ++i) {
            _onJoinExitPoolAmounts.push(amounts[i]);
        }

        delete _onJoinPoolDueProtocolFeeAmounts;
        for (uint256 i = 0; i < dueProtocolFeeAmounts.length; ++i) {
            _onJoinPoolDueProtocolFeeAmounts.push(dueProtocolFeeAmounts[i]);
        }
    }

    event OnJoinPoolCalled(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] currentBalances,
        uint256[] maxAmountsIn,
        uint256 protocolSwapFee,
        bytes userData
    );

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256[] memory maxAmountsIn,
        uint256 protocolSwapFee,
        bytes memory userData
    ) external override returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) {
        emit OnJoinPoolCalled(poolId, sender, recipient, currentBalances, maxAmountsIn, protocolSwapFee, userData);

        (amountsIn, dueProtocolFeeAmounts) = abi.decode(userData, (uint256[], uint256[]));
    }

    function onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        uint256,
        bytes memory
    ) external view override returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) {
        amountsOut = new uint256[](_onJoinExitPoolAmounts.length);
        for (uint256 i = 0; i < amountsOut.length; ++i) {
            amountsOut[i] = _onJoinExitPoolAmounts[i];
        }

        dueProtocolFeeAmounts = new uint256[](_onJoinPoolDueProtocolFeeAmounts.length);
        for (uint256 i = 0; i < dueProtocolFeeAmounts.length; ++i) {
            dueProtocolFeeAmounts[i] = _onJoinPoolDueProtocolFeeAmounts[i];
        }
    }

    // Amounts in are multiplied by the multiplier, amounts out divided by it
    uint256 private _multiplier = FixedPoint.ONE;

    function setMultiplier(uint256 newMultiplier) external {
        _multiplier = newMultiplier;
    }

    // IGeneralPoolQuote
    function quoteOutGivenIn(
        IPoolQuoteStructs.QuoteRequestGivenIn calldata request,
        uint256[] calldata,
        uint256,
        uint256
    ) external view override returns (uint256) {
        return request.amountIn.mul(_multiplier);
    }

    function quoteInGivenOut(
        IPoolQuoteStructs.QuoteRequestGivenOut calldata request,
        uint256[] calldata,
        uint256,
        uint256
    ) external view override returns (uint256) {
        uint256 amountIn = request.amountOut.div(_multiplier);
        return amountIn;
    }

    // IMinimalSwapInfoPoolQuote
    function quoteOutGivenIn(
        IPoolQuoteStructs.QuoteRequestGivenIn calldata request,
        uint256,
        uint256
    ) external view override returns (uint256) {
        return request.amountIn.mul(_multiplier);
    }

    function quoteInGivenOut(
        IPoolQuoteStructs.QuoteRequestGivenOut calldata request,
        uint256,
        uint256
    ) external view override returns (uint256) {
        uint256 amountIn = request.amountOut.div(_multiplier);
        return amountIn;
    }
}
