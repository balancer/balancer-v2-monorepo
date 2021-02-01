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
import "../../vendor/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../BalancerPoolToken.sol";

import "../../vault/interfaces/IVault.sol";
import "../../vault/interfaces/IPool.sol";
import "../../vault/interfaces/IGeneralPoolQuote.sol";
import "../../math/FixedPoint.sol";
import "../../helpers/UnsafeRandom.sol";

import "./StableMath.sol";

contract StablePool is IPool, IGeneralPoolQuote, StableMath, BalancerPoolToken, ReentrancyGuard {
    using FixedPoint for uint256;

    IVault private immutable _vault;
    bytes32 private immutable _poolId;

    uint256 private immutable _amp;
    uint256 private immutable _swapFee;

    uint256 private _lastInvariant;

    uint256 private constant _MAX_SWAP_FEE = 10 * (10**16); // 10%

    uint8 private constant _MAX_TOKENS = 16;

    //TODO: document this limit
    uint256 private constant _MIN_AMP = 50 * (10**18);
    uint256 private constant _MAX_AMP = 2000 * (10**18);

    /**
     * @dev This contract cannot be deployed directly because it must be an Universal Agent during construction. Use
     * `StablePoolFactory` to create new instances of it instead.
     */
    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 amp,
        uint256 swapFee
    ) BalancerPoolToken(name, symbol) {
        require(tokens.length >= 2, "ERR_MIN_TOKENS");
        require(tokens.length <= _MAX_TOKENS, "ERR_MAX_TOKENS");

        bytes32 poolId = vault.registerPool(IVault.PoolSpecialization.GENERAL);

        // Pass in zero addresses for Asset Managers
        vault.registerTokens(poolId, tokens, new address[](tokens.length));

        // Set immutable state variables - these cannot be read from during construction
        _vault = vault;
        _poolId = poolId;

        require(swapFee <= _MAX_SWAP_FEE, "ERR_MAX_SWAP_FEE");
        _swapFee = swapFee;

        require(amp >= _MIN_AMP, "ERR_MIN_AMP");
        require(amp <= _MAX_AMP, "ERR_MAX_AMP");
        _amp = amp;
    }

    //Getters

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function getAmplification() external view returns (uint256) {
        return _amp;
    }

    function getSwapFee() external view returns (uint256) {
        return _swapFee;
    }

    // Join / Exit Hooks

    function _getAndApplyDueProtocolFeeAmounts(uint256[] memory currentBalances, uint256 protocolFeePercentage)
        private
        view
        returns (uint256[] memory)
    {
        // Compute by how much a token balance increased to go from last invariant to current invariant

        uint256 chosenTokenIndex = UnsafeRandom.rand(currentBalances.length);

        uint256 chosenTokenAccruedFees = _calculateOneTokenSwapFee(
            _amp,
            currentBalances,
            _lastInvariant,
            chosenTokenIndex
        );

        uint256 chosenTokenDueProtocolFeeAmount = chosenTokenAccruedFees.mul(protocolFeePercentage);

        uint256[] memory dueProtocolFeeAmounts = new uint256[](currentBalances.length);
        // All other values are initialized to zero
        dueProtocolFeeAmounts[chosenTokenIndex] = chosenTokenDueProtocolFeeAmount;

        currentBalances[chosenTokenIndex] = currentBalances[chosenTokenIndex].sub(chosenTokenDueProtocolFeeAmount);

        return dueProtocolFeeAmounts;
    }

    enum JoinKind { INIT, ALL_TOKENS_IN_FOR_EXACT_BPT_OUT }

    function onJoinPool(
        bytes32 poolId,
        address, // sender - potential whitelisting
        address recipient,
        uint256[] memory currentBalances,
        uint256[] memory maxAmountsIn,
        uint256 protocolFeePercentage,
        bytes memory userData
    ) external override returns (uint256[] memory, uint256[] memory) {
        require(msg.sender == address(_vault), "ERR_CALLER_NOT_VAULT");
        require(poolId == _poolId, "INVALID_POOL_ID");

        // The Vault guarantees currentBalances and maxAmountsIn have the same length

        JoinKind kind = abi.decode(userData, (JoinKind));

        if (kind == JoinKind.INIT) {
            return _joinInitial(currentBalances.length, recipient, maxAmountsIn);
        } else {
            // JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT
            (, uint256 bptAmountOut) = abi.decode(userData, (JoinKind, uint256));
            return
                _joinAllTokensInForExactBPTOut(
                    currentBalances.length,
                    currentBalances,
                    recipient,
                    maxAmountsIn,
                    protocolFeePercentage,
                    bptAmountOut
                );
        }
    }

    function _joinInitial(
        uint256 totalTokens,
        address recipient,
        uint256[] memory maxAmountsIn
    ) private returns (uint256[] memory, uint256[] memory) {
        require(totalSupply() == 0, "ERR_ALREADY_INITIALIZED");

        // Pool initialization - currentBalances should be all zeroes

        // _lastInvariant should also be zero
        uint256 invariantAfterJoin = _invariant(_amp, maxAmountsIn);

        _mintPoolTokens(recipient, invariantAfterJoin);
        _lastInvariant = invariantAfterJoin;

        uint256[] memory dueProtocolFeeAmounts = new uint256[](totalTokens); // All zeroes
        return (maxAmountsIn, dueProtocolFeeAmounts);
    }

    function _joinAllTokensInForExactBPTOut(
        uint256 totalTokens,
        uint256[] memory currentBalances,
        address recipient,
        uint256[] memory,
        uint256 protocolFeePercentage,
        uint256 bptAmountOut
    ) private returns (uint256[] memory, uint256[] memory) {
        require(totalSupply() > 0, "ERR_UNINITIALIZED");

        // This updates currentBalances by deducting protocol fees to pay, which the Vault will charge the Pool once
        // this function returns.
        uint256[] memory dueProtocolFeeAmounts = _getAndApplyDueProtocolFeeAmounts(
            currentBalances,
            protocolFeePercentage
        );

        uint256 bptRatio = _getSupplyRatio(bptAmountOut);

        uint256[] memory amountsIn = new uint256[](totalTokens);
        for (uint256 i = 0; i < totalTokens; i++) {
            amountsIn[i] = currentBalances[i].mul(bptRatio);
        }

        _mintPoolTokens(recipient, bptAmountOut);

        for (uint8 i = 0; i < totalTokens; i++) {
            currentBalances[i] = currentBalances[i].add(amountsIn[i]);
        }

        // Reset swap fee accumulation
        _lastInvariant = _invariant(_amp, currentBalances);

        return (amountsIn, dueProtocolFeeAmounts);
    }

    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT }

    function onExitPool(
        bytes32 poolId,
        address sender,
        address, //recipient -  potential whitelisting
        uint256[] memory currentBalances,
        uint256[] memory minAmountsOut,
        uint256 protocolFeePercentage,
        bytes memory userData
    ) external override returns (uint256[] memory, uint256[] memory) {
        require(msg.sender == address(_vault), "ERR_CALLER_NOT_VAULT");
        require(poolId == _poolId, "INVALID_POOL_ID");

        // The Vault guarantees currentBalances and minAmountsOut have the same length

        uint256[] memory dueProtocolFeeAmounts = _getAndApplyDueProtocolFeeAmounts(
            currentBalances,
            protocolFeePercentage
        );

        // There is only one Exit Kind
        (, uint256 bptAmountIn) = abi.decode(userData, (ExitKind, uint256));
        uint256 totalTokens = currentBalances.length;

        uint256[] memory amountsOut = _exitExactBPTInForAllTokensOut(
            totalTokens,
            currentBalances,
            minAmountsOut,
            bptAmountIn
        );

        _burnPoolTokens(sender, bptAmountIn);

        // Reset swap fee accumulation
        for (uint256 i = 0; i < totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].sub(amountsOut[i]);
        }
        _lastInvariant = _invariant(_amp, currentBalances);

        return (amountsOut, dueProtocolFeeAmounts);
    }

    function _exitExactBPTInForAllTokensOut(
        uint256 totalTokens,
        uint256[] memory currentBalances,
        uint256[] memory minAmountsOut,
        uint256 bptAmountIn
    ) private view returns (uint256[] memory amountsOut) {
        uint256 bptRatio = _getSupplyRatio(bptAmountIn);

        amountsOut = new uint256[](totalTokens);
        for (uint256 i = 0; i < totalTokens; i++) {
            uint256 amountOut = currentBalances[i].mul(bptRatio);
            require(amountOut >= minAmountsOut[i], "ERR_EXIT_BELOW_REQUESTED_MINIMUM");

            amountsOut[i] = amountOut;
        }
    }

    //Quote Swaps

    function quoteOutGivenIn(
        IPoolQuoteStructs.QuoteRequestGivenIn calldata request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint256) {
        _validateIndexes(indexIn, indexOut, balances.length);

        uint256 adjustedIn = _subtractSwapFee(request.amountIn);
        uint256 maximumAmountOut = _outGivenIn(_amp, balances, indexIn, indexOut, adjustedIn);
        return maximumAmountOut;
    }

    function quoteInGivenOut(
        IPoolQuoteStructs.QuoteRequestGivenOut calldata request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint256) {
        _validateIndexes(indexIn, indexOut, balances.length);

        uint256 minimumAmountIn = _inGivenOut(_amp, balances, indexIn, indexOut, request.amountOut);
        return _addSwapFee(minimumAmountIn);
    }

    // Potential helpers

    function _getSupplyRatio(uint256 amount) private view returns (uint256) {
        uint256 poolTotal = totalSupply();
        uint256 ratio = amount.div(poolTotal);
        require(ratio != 0, "ERR_MATH_APPROX");
        return ratio;
    }

    function _addSwapFee(uint256 amount) private view returns (uint256) {
        return amount.div(uint256(FixedPoint.ONE).sub(_swapFee));
    }

    function _subtractSwapFee(uint256 amount) private view returns (uint256) {
        uint256 fees = amount.mul(_swapFee);
        return amount.sub(fees);
    }

    function _validateIndexes(
        uint256 indexIn,
        uint256 indexOut,
        uint256 limit
    ) internal pure {
        require(indexIn < limit && indexOut < limit, "ERR_INDEX_OUT_OF_BOUNDS");
    }
}
