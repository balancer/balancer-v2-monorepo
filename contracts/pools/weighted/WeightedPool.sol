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

import "../../math/FixedPoint.sol";
import "../../helpers/UnsafeRandom.sol";
import "../../vendor/ReentrancyGuard.sol";

import "../../vault/interfaces/IVault.sol";
import "../../vault/interfaces/IPool.sol";
import "../../vault/interfaces/IMinimalSwapInfoPoolQuote.sol";

import "./WeightedMath.sol";
import "../BalancerPoolToken.sol";

// This contract relies on tons of immutable state variables to
// perform efficient lookup, without resorting to storage reads.
// solhint-disable max-states-count

contract WeightedPool is IPool, IMinimalSwapInfoPoolQuote, BalancerPoolToken, WeightedMath, ReentrancyGuard {
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    IVault private immutable _vault;
    bytes32 private immutable _poolId;

    uint8 private constant _MIN_TOKENS = 2;
    uint8 private constant _MAX_TOKENS = 16;

    IERC20 private immutable _token0;
    IERC20 private immutable _token1;
    IERC20 private immutable _token2;
    IERC20 private immutable _token3;
    IERC20 private immutable _token4;
    IERC20 private immutable _token5;
    IERC20 private immutable _token6;
    IERC20 private immutable _token7;
    IERC20 private immutable _token8;
    IERC20 private immutable _token9;
    IERC20 private immutable _token10;
    IERC20 private immutable _token11;
    IERC20 private immutable _token12;
    IERC20 private immutable _token13;
    IERC20 private immutable _token14;
    IERC20 private immutable _token15;

    uint256 private immutable _totalTokens;

    uint256 private immutable _normalizedWeight0;
    uint256 private immutable _normalizedWeight1;
    uint256 private immutable _normalizedWeight2;
    uint256 private immutable _normalizedWeight3;
    uint256 private immutable _normalizedWeight4;
    uint256 private immutable _normalizedWeight5;
    uint256 private immutable _normalizedWeight6;
    uint256 private immutable _normalizedWeight7;
    uint256 private immutable _normalizedWeight8;
    uint256 private immutable _normalizedWeight9;
    uint256 private immutable _normalizedWeight10;
    uint256 private immutable _normalizedWeight11;
    uint256 private immutable _normalizedWeight12;
    uint256 private immutable _normalizedWeight13;
    uint256 private immutable _normalizedWeight14;
    uint256 private immutable _normalizedWeight15;

    uint256 private immutable _swapFee;

    uint256 private _lastInvariant;

    uint256 private constant _MIN_SWAP_FEE = 0;
    uint256 private constant _MAX_SWAP_FEE = 10 * (10**16); // 10%

    /**
     * @dev This contract cannot be deployed directly because it must be an Universal Agent during construction. Use
     * `WeightedPoolFactory` to create new instances of it instead.
     */
    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFee
    ) BalancerPoolToken(name, symbol) {
        require(tokens.length >= _MIN_TOKENS, "ERR_MIN_TOKENS");
        require(tokens.length <= _MAX_TOKENS, "ERR_MAX_TOKENS");
        require(tokens.length == weights.length, "ERR_TOKENS_WEIGHTS_LENGTH");

        IVault.PoolSpecialization specialization = tokens.length == 2
            ? IVault.PoolSpecialization.TWO_TOKEN
            : IVault.PoolSpecialization.MINIMAL_SWAP_INFO;

        bytes32 poolId = vault.registerPool(specialization);

        // Pass in zero addresses for Asset Managers
        vault.registerTokens(poolId, tokens, new address[](tokens.length));

        // Set immutable state variables - these cannot be read from during construction
        _vault = vault;
        _poolId = poolId;
        _totalTokens = tokens.length;

        require(swapFee >= _MIN_SWAP_FEE, "ERR_MIN_SWAP_FEE");
        require(swapFee <= _MAX_SWAP_FEE, "ERR_MAX_SWAP_FEE");
        _swapFee = swapFee;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = tokens.length > 0 ? tokens[0] : IERC20(0);
        _token1 = tokens.length > 1 ? tokens[1] : IERC20(0);
        _token2 = tokens.length > 2 ? tokens[2] : IERC20(0);
        _token3 = tokens.length > 3 ? tokens[3] : IERC20(0);
        _token4 = tokens.length > 4 ? tokens[4] : IERC20(0);
        _token5 = tokens.length > 5 ? tokens[5] : IERC20(0);
        _token6 = tokens.length > 6 ? tokens[6] : IERC20(0);
        _token7 = tokens.length > 7 ? tokens[7] : IERC20(0);
        _token8 = tokens.length > 8 ? tokens[8] : IERC20(0);
        _token9 = tokens.length > 9 ? tokens[9] : IERC20(0);
        _token10 = tokens.length > 10 ? tokens[10] : IERC20(0);
        _token11 = tokens.length > 11 ? tokens[11] : IERC20(0);
        _token12 = tokens.length > 12 ? tokens[12] : IERC20(0);
        _token13 = tokens.length > 13 ? tokens[13] : IERC20(0);
        _token14 = tokens.length > 14 ? tokens[14] : IERC20(0);
        _token15 = tokens.length > 15 ? tokens[15] : IERC20(0);

        // Compute normalized weights
        uint256 sumWeights = 0;
        for (uint8 i = 0; i < weights.length; i++) {
            sumWeights = sumWeights.add(weights[i]);
        }
        uint256[] memory normalizedWeights = new uint256[](weights.length);
        for (uint8 i = 0; i < normalizedWeights.length; i++) {
            normalizedWeights[i] = weights[i].div(sumWeights);
        }

        _normalizedWeight0 = weights.length > 0 ? normalizedWeights[0] : 0;
        _normalizedWeight1 = weights.length > 1 ? normalizedWeights[1] : 0;
        _normalizedWeight2 = weights.length > 2 ? normalizedWeights[2] : 0;
        _normalizedWeight3 = weights.length > 3 ? normalizedWeights[3] : 0;
        _normalizedWeight4 = weights.length > 4 ? normalizedWeights[4] : 0;
        _normalizedWeight5 = weights.length > 5 ? normalizedWeights[5] : 0;
        _normalizedWeight6 = weights.length > 6 ? normalizedWeights[6] : 0;
        _normalizedWeight7 = weights.length > 7 ? normalizedWeights[7] : 0;
        _normalizedWeight8 = weights.length > 8 ? normalizedWeights[8] : 0;
        _normalizedWeight9 = weights.length > 9 ? normalizedWeights[9] : 0;
        _normalizedWeight10 = weights.length > 10 ? normalizedWeights[10] : 0;
        _normalizedWeight11 = weights.length > 11 ? normalizedWeights[11] : 0;
        _normalizedWeight12 = weights.length > 12 ? normalizedWeights[12] : 0;
        _normalizedWeight13 = weights.length > 13 ? normalizedWeights[13] : 0;
        _normalizedWeight14 = weights.length > 14 ? normalizedWeights[14] : 0;
        _normalizedWeight15 = weights.length > 15 ? normalizedWeights[15] : 0;
    }

    function _normalizedWeight(IERC20 token) internal view returns (uint256) {
        // prettier-ignore
        if (token == _token0) { return _normalizedWeight0; }
        else if (token == _token1) { return _normalizedWeight1; }
        else if (token == _token2) { return _normalizedWeight2; }
        else if (token == _token3) { return _normalizedWeight3; }
        else if (token == _token4) { return _normalizedWeight4; }
        else if (token == _token5) { return _normalizedWeight5; }
        else if (token == _token6) { return _normalizedWeight6; }
        else if (token == _token7) { return _normalizedWeight7; }
        else if (token == _token8) { return _normalizedWeight8; }
        else if (token == _token9) { return _normalizedWeight9; }
        else if (token == _token10) { return _normalizedWeight10; }
        else if (token == _token11) { return _normalizedWeight11; }
        else if (token == _token12) { return _normalizedWeight12; }
        else if (token == _token13) { return _normalizedWeight13; }
        else if (token == _token14) { return _normalizedWeight14; }
        else if (token == _token15) { return _normalizedWeight15; }
        else {
            revert("ERR_INVALID_TOKEN");
        }
    }

    function _normalizedWeights() internal view returns (uint256[] memory) {
        uint256[] memory normalizedWeights = new uint256[](_totalTokens);

        // prettier-ignore
        {
            if (_totalTokens > 0) { normalizedWeights[0] = _normalizedWeight0; } else { return normalizedWeights; }
            if (_totalTokens > 1) { normalizedWeights[1] = _normalizedWeight1; } else { return normalizedWeights; }
            if (_totalTokens > 2) { normalizedWeights[2] = _normalizedWeight2; } else { return normalizedWeights; }
            if (_totalTokens > 3) { normalizedWeights[3] = _normalizedWeight3; } else { return normalizedWeights; }
            if (_totalTokens > 4) { normalizedWeights[4] = _normalizedWeight4; } else { return normalizedWeights; }
            if (_totalTokens > 5) { normalizedWeights[5] = _normalizedWeight5; } else { return normalizedWeights; }
            if (_totalTokens > 6) { normalizedWeights[6] = _normalizedWeight6; } else { return normalizedWeights; }
            if (_totalTokens > 7) { normalizedWeights[7] = _normalizedWeight7; } else { return normalizedWeights; }
            if (_totalTokens > 8) { normalizedWeights[8] = _normalizedWeight8; } else { return normalizedWeights; }
            if (_totalTokens > 9) { normalizedWeights[9] = _normalizedWeight9; } else { return normalizedWeights; }
            if (_totalTokens > 10) { normalizedWeights[10] = _normalizedWeight10; } else { return normalizedWeights; }
            if (_totalTokens > 11) { normalizedWeights[11] = _normalizedWeight11; } else { return normalizedWeights; }
            if (_totalTokens > 12) { normalizedWeights[12] = _normalizedWeight12; } else { return normalizedWeights; }
            if (_totalTokens > 13) { normalizedWeights[13] = _normalizedWeight13; } else { return normalizedWeights; }
            if (_totalTokens > 14) { normalizedWeights[14] = _normalizedWeight14; } else { return normalizedWeights; }
            if (_totalTokens > 15) { normalizedWeights[15] = _normalizedWeight15; } else { return normalizedWeights; }
        }

        return normalizedWeights;
    }

    //Getters

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function getLastInvariant() external view returns (uint256) {
        return _lastInvariant;
    }

    function getInvariant() external view returns (uint256) {
        (IERC20[] memory tokens, uint256[] memory balances) = _vault.getPoolTokens(_poolId);
        uint256[] memory normalizedWeights = getNormalizedWeights(tokens);
        return _invariant(normalizedWeights, balances);
    }

    function getNormalizedWeights(IERC20[] memory tokens) public view returns (uint256[] memory normalizedWeights) {
        normalizedWeights = new uint256[](tokens.length);
        for (uint256 i = 0; i < normalizedWeights.length; ++i) {
            normalizedWeights[i] = _normalizedWeight(tokens[i]);
        }
    }

    function getSwapFee() external view returns (uint256) {
        return _swapFee;
    }

    // Join / Exit Hooks

    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT }

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

        // TODO: This seems inconsistent w/ `getInvariant` for example. We assume the weights and balances order match
        uint256[] memory normalizedWeights = _normalizedWeights();
        JoinKind kind = abi.decode(userData, (JoinKind));

        if (kind == JoinKind.INIT) {
            //Max amounts in are equal to amounts in.
            return _joinInitial(normalizedWeights, recipient, maxAmountsIn);
        } else {
            // JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT
            //Max amounts in are equal to exact amounts in.
            (, uint256 minimumBPT) = abi.decode(userData, (JoinKind, uint256));
            return
                _joinExactTokensInForBPTOut(
                    normalizedWeights,
                    currentBalances,
                    recipient,
                    maxAmountsIn,
                    minimumBPT,
                    protocolFeePercentage
                );
        }
    }

    function _joinInitial(
        uint256[] memory normalizedWeights,
        address recipient,
        uint256[] memory amountsIn
    ) private returns (uint256[] memory, uint256[] memory) {
        require(totalSupply() == 0, "ERR_ALREADY_INITIALIZED");

        // Pool initialization - currentBalances should be all zeroes

        // _lastInvariant should also be zero
        uint256 invariantAfterJoin = _invariant(normalizedWeights, amountsIn);

        _mintPoolTokens(recipient, invariantAfterJoin);
        _lastInvariant = invariantAfterJoin;

        uint256[] memory dueProtocolFeeAmounts = new uint256[](_totalTokens); // All zeroes
        return (amountsIn, dueProtocolFeeAmounts);
    }

    function _joinExactTokensInForBPTOut(
        uint256[] memory normalizedWeights,
        uint256[] memory currentBalances,
        address recipient,
        uint256[] memory amountsIn,
        uint256 minimumBPT,
        uint256 protocolFeePercentage
    ) private returns (uint256[] memory, uint256[] memory) {
        uint256 currentBPT = totalSupply();
        require(currentBPT > 0, "ERR_UNINITIALIZED");

        // This updates currentBalances by deducting protocol fees to pay, which the Vault will charge the Pool once
        // this function returns.
        uint256[] memory dueProtocolFeeAmounts = _getAndApplyDueProtocolFeeAmounts(
            currentBalances,
            normalizedWeights,
            protocolFeePercentage
        );

        uint256 bptAmountOut = _exactTokensInForBPTOut(
            currentBalances,
            normalizedWeights,
            amountsIn,
            currentBPT,
            _swapFee
        );

        require(bptAmountOut >= minimumBPT, "ERR_BPT_OUT_MIN_AMOUNT");

        _mintPoolTokens(recipient, bptAmountOut);

        for (uint8 i = 0; i < _totalTokens; i++) {
            currentBalances[i] = currentBalances[i].add(amountsIn[i]);
        }

        // Reset swap fee accumulation
        _lastInvariant = _invariant(normalizedWeights, currentBalances);

        return (amountsIn, dueProtocolFeeAmounts);
    }

    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_ALL_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }

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

        uint256[] memory normalizedWeights = _normalizedWeights();
        // This updates currentBalances by deducting protocol fees to pay, which the Vault will charge the Pool once
        // this function returns.
        uint256[] memory dueProtocolFeeAmounts = _getAndApplyDueProtocolFeeAmounts(
            currentBalances,
            normalizedWeights,
            protocolFeePercentage
        );

        uint256 bptAmountIn;
        uint256[] memory amountsOut;

        ExitKind kind = abi.decode(userData, (ExitKind));
        if (kind == ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            uint256 tokenIndex;
            (, bptAmountIn, tokenIndex) = abi.decode(userData, (ExitKind, uint256, uint256));

            (bptAmountIn, amountsOut) = _exitExactBPTInForOneTokenOut(
                normalizedWeights,
                currentBalances,
                bptAmountIn,
                tokenIndex
            );
        } else if (kind == ExitKind.EXACT_BPT_IN_FOR_ALL_TOKENS_OUT) {
            (, bptAmountIn) = abi.decode(userData, (ExitKind, uint256));

            (bptAmountIn, amountsOut) = _exitExactBPTInForAllTokensOut(currentBalances, bptAmountIn);
        } else {
            // ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT
            (, uint256 maxBPTAmountIn) = abi.decode(userData, (ExitKind, uint256));

            //Min amounts out are equal to amounts out
            (bptAmountIn, amountsOut) = _exitBPTInForExactTokensOut(
                normalizedWeights,
                currentBalances,
                minAmountsOut,
                maxBPTAmountIn
            );
        }

        _burnPoolTokens(sender, bptAmountIn);

        for (uint256 i = 0; i < _totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].sub(amountsOut[i]);
        }

        // Reset swap fee accumulation
        _lastInvariant = _invariant(normalizedWeights, currentBalances);

        return (amountsOut, dueProtocolFeeAmounts);
    }

    function _exitExactBPTInForOneTokenOut(
        uint256[] memory normalizedWeights,
        uint256[] memory currentBalances,
        uint256 bptAmountIn,
        uint256 tokenIndex
    ) private view returns (uint256, uint256[] memory) {
        require(tokenIndex < currentBalances.length, "ERR_INVALID_TOKEN_INDEX");

        uint256[] memory amountsOut = new uint256[](_totalTokens);
        amountsOut[tokenIndex] = _exactBPTInForTokenOut(
            currentBalances[tokenIndex],
            normalizedWeights[tokenIndex],
            bptAmountIn,
            totalSupply(),
            _swapFee
        );
        return (bptAmountIn, amountsOut);
    }

    function _exitExactBPTInForAllTokensOut(uint256[] memory currentBalances, uint256 bptAmountIn)
        private
        view
        returns (uint256, uint256[] memory)
    {
        uint256 bptRatio = _getSupplyRatio(bptAmountIn);

        uint256[] memory amountsOut = new uint256[](_totalTokens);
        for (uint256 i = 0; i < _totalTokens; i++) {
            amountsOut[i] = currentBalances[i].mul(bptRatio);
        }
        return (bptAmountIn, amountsOut);
    }

    function _exitBPTInForExactTokensOut(
        uint256[] memory normalizedWeights,
        uint256[] memory currentBalances,
        uint256[] memory amountsOut,
        uint256 maxBPTAmountIn
    ) private view returns (uint256, uint256[] memory) {
        uint256 bptAmountIn = _bptInForExactTokensOut(
            currentBalances,
            normalizedWeights,
            amountsOut,
            totalSupply(),
            _swapFee
        );
        require(bptAmountIn <= maxBPTAmountIn, "ERR_BPT_IN_MAX_AMOUNT");
        return (bptAmountIn, amountsOut);
    }

    function _getAndApplyDueProtocolFeeAmounts(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        uint256 protocolFeePercentage
    ) private view returns (uint256[] memory) {
        // Compute by how much a token balance increased to go from last invariant to current invariant

        // balanceToken * ( 1 - (lastInvariant / currentInvariant) ^ (1 / weightToken))

        uint256 chosenTokenIndex = 1; // UnsafeRandom.rand(_totalTokens);

        uint256 exponent = FixedPoint.ONE.div(normalizedWeights[chosenTokenIndex]);

        uint256 currentInvariant = _invariant(normalizedWeights, currentBalances);
        uint256 invariantRatio = _lastInvariant.div(currentInvariant);

        uint256 chosenTokenAccruedFees = currentBalances[chosenTokenIndex].mul(
            FixedPoint.ONE.sub(LogExpMath.pow(invariantRatio, exponent))
        );
        uint256 chosenTokenDueProtocolFeeAmount = chosenTokenAccruedFees.mul(protocolFeePercentage);

        uint256[] memory dueProtocolFeeAmounts = new uint256[](currentBalances.length);
        // All other values are initialized to zero
        dueProtocolFeeAmounts[chosenTokenIndex] = chosenTokenDueProtocolFeeAmount;

        currentBalances[chosenTokenIndex] = currentBalances[chosenTokenIndex].sub(chosenTokenDueProtocolFeeAmount);

        return dueProtocolFeeAmounts;
    }

    //Quote Swaps

    function quoteOutGivenIn(
        IPoolQuoteStructs.QuoteRequestGivenIn calldata request,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) external view override returns (uint256) {
        uint256 adjustedIn = _subtractSwapFee(request.amountIn);

        // Calculate the maximum amount that can be taken out of the pool
        uint256 maximumAmountOut = _outGivenIn(
            currentBalanceTokenIn,
            _normalizedWeight(request.tokenIn),
            currentBalanceTokenOut,
            _normalizedWeight(request.tokenOut),
            adjustedIn
        );

        return maximumAmountOut;
    }

    function quoteInGivenOut(
        IPoolQuoteStructs.QuoteRequestGivenOut calldata request,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) external view override returns (uint256) {
        // Calculate the minimum amount that must be put into the pool
        uint256 minimumAmountIn = _inGivenOut(
            currentBalanceTokenIn,
            _normalizedWeight(request.tokenIn),
            currentBalanceTokenOut,
            _normalizedWeight(request.tokenOut),
            request.amountOut
        );

        return _addSwapFee(minimumAmountIn);
    }

    // Potential helpers

    function _getSupplyRatio(uint256 amount) internal view returns (uint256) {
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
}
