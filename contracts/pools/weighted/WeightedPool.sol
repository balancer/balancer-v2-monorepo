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

import "../../math/FixedPoint.sol";
import "../../helpers/UnsafeRandom.sol";

import "../../vault/interfaces/IVault.sol";
import "../../vault/interfaces/IPoolQuoteSimplified.sol";

import "../BalancerPoolToken.sol";
import "../IBPTPool.sol";
import "./WeightedMath.sol";

// This contract relies on tons of immutable state variables to
// perform efficient lookup, without resorting to storage reads.
// solhint-disable max-states-count

contract WeightedPool is IBPTPool, IPoolQuoteSimplified, BalancerPoolToken, WeightedMath, ReentrancyGuard {
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
    uint256 private _sumWeights;

    uint256 private immutable _weight0;
    uint256 private immutable _weight1;
    uint256 private immutable _weight2;
    uint256 private immutable _weight3;
    uint256 private immutable _weight4;
    uint256 private immutable _weight5;
    uint256 private immutable _weight6;
    uint256 private immutable _weight7;
    uint256 private immutable _weight8;
    uint256 private immutable _weight9;
    uint256 private immutable _weight10;
    uint256 private immutable _weight11;
    uint256 private immutable _weight12;
    uint256 private immutable _weight13;
    uint256 private immutable _weight14;
    uint256 private immutable _weight15;

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
        uint256 initialBPT,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address from,
        uint256[] memory weights,
        uint256 swapFee
    ) BalancerPoolToken(name, symbol) {
        require(tokens.length >= _MIN_TOKENS, "ERR__MIN_TOKENS");
        require(tokens.length <= _MAX_TOKENS, "ERR__MAX_TOKENS");

        require(tokens.length == amounts.length, "ERR_TOKENS_AMOUNTS_LENGTH");
        require(tokens.length == weights.length, "ERR_TOKENS_WEIGHTS_LENGTH");

        // TODO: make it TWO_TOKEN if tokens.length == 2
        IVault.PoolOptimization optimization = IVault.PoolOptimization.SIMPLIFIED_QUOTE;

        bytes32 poolId = vault.registerPool(optimization);
        // Pass in zero addresses for Asset Managers
        vault.registerTokens(poolId, tokens, new address[](tokens.length));
        vault.addLiquidity(poolId, from, tokens, amounts, false);

        require(vault.getPoolTokens(poolId).length == tokens.length, "ERR_REPEATED_TOKENS");

        _mintPoolTokens(from, initialBPT);

        // Set immutable state variables - these cannot be read from during construction
        _vault = vault;
        _poolId = poolId;

        _totalTokens = tokens.length;

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

        _weight0 = weights.length > 0 ? weights[0] : 0;
        _weight1 = weights.length > 1 ? weights[1] : 0;
        _weight2 = weights.length > 2 ? weights[2] : 0;
        _weight3 = weights.length > 3 ? weights[3] : 0;
        _weight4 = weights.length > 4 ? weights[4] : 0;
        _weight5 = weights.length > 5 ? weights[5] : 0;
        _weight6 = weights.length > 6 ? weights[6] : 0;
        _weight7 = weights.length > 7 ? weights[7] : 0;
        _weight8 = weights.length > 8 ? weights[8] : 0;
        _weight9 = weights.length > 9 ? weights[9] : 0;
        _weight10 = weights.length > 10 ? weights[10] : 0;
        _weight11 = weights.length > 11 ? weights[11] : 0;
        _weight12 = weights.length > 12 ? weights[12] : 0;
        _weight13 = weights.length > 13 ? weights[13] : 0;
        _weight14 = weights.length > 14 ? weights[14] : 0;
        _weight15 = weights.length > 15 ? weights[15] : 0;

        require(swapFee >= _MIN_SWAP_FEE, "ERR__MIN_SWAP_FEE");
        require(swapFee <= _MAX_SWAP_FEE, "ERR_MAX_MAX_FEE");
        _swapFee = swapFee;

        //Saves the sum of the weights
        uint256 sumWeights = 0;
        for (uint8 i = 0; i < weights.length; i++) {
            sumWeights = sumWeights.add(weights[i]);
        }
        _sumWeights = sumWeights;

        //Reset Invariant
        _resetAccumulatedSwapFees(tokens, weights, amounts);
    }

    function _weight(IERC20 token) private view returns (uint256) {
        if (token == _token0) {
            return _weight0;
        } else if (token == _token1) {
            return _weight1;
        } else if (token == _token2) {
            return _weight2;
        } else if (token == _token3) {
            return _weight3;
        } else if (token == _token4) {
            return _weight4;
        } else if (token == _token5) {
            return _weight5;
        } else if (token == _token6) {
            return _weight6;
        } else if (token == _token7) {
            return _weight7;
        } else if (token == _token8) {
            return _weight8;
        } else if (token == _token9) {
            return _weight9;
        } else if (token == _token10) {
            return _weight10;
        } else if (token == _token11) {
            return _weight11;
        } else if (token == _token12) {
            return _weight12;
        } else if (token == _token13) {
            return _weight13;
        } else if (token == _token14) {
            return _weight14;
        } else if (token == _token15) {
            return _weight15;
        } else {
            revert("ERR_INVALID_TOKEN");
        }
    }

    function _weights(IERC20[] memory tokens) internal view returns (uint256[] memory) {
        uint256[] memory weights = new uint256[](tokens.length);

        for (uint256 i = 0; i < weights.length; ++i) {
            weights[i] = _weight(tokens[i]);
        }

        return weights;
    }

    /**
     * @dev Internal function to tell the normalized weight associated to a token
     * @param token Address of the token querying the normalized weight of
     */
    function _normalizedWeight(IERC20 token) internal view returns (uint256) {
        return _weight(token).div(_sumWeights);
    }

    //Getters

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function getWeights(IERC20[] memory tokens) external view returns (uint256[] memory) {
        return _weights(tokens);
    }

    /**
     * @dev Returns the normalized weight associated to a token
     * @param token Address of the token querying the normalized weight of
     */
    function getNormalizedWeight(IERC20 token) external view returns (uint256) {
        return _normalizedWeight(token);
    }

    function getSwapFee() external view returns (uint256) {
        return _swapFee;
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
            _weight(request.tokenIn),
            currentBalanceTokenOut,
            _weight(request.tokenOut),
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
            _weight(request.tokenIn),
            currentBalanceTokenOut,
            _weight(request.tokenOut),
            request.amountOut
        );

        return _addSwapFee(minimumAmountIn);
    }

    //Protocol Fees

    function _payProtocolFees(IERC20[] memory tokens, uint256[] memory balances) internal returns (uint256[] memory) {
        uint256[] memory swapFeesCollected = _getAccumulatedSwapFees(tokens, balances);
        return _vault.paySwapProtocolFees(_poolId, tokens, swapFeesCollected);
    }

    /**************************************************************************************************/
    /***********  balanceToken ( 1 - (lastInvariant / currentInvariant)^(1 / weightToken) ) ***********
    /**************************************************************************************************/
    function _getAccumulatedSwapFees(IERC20[] memory tokens, uint256[] memory balances)
        internal
        view
        returns (uint256[] memory)
    {
        uint256[] memory swapFeesCollected = new uint256[](tokens.length);

        uint256 currentInvariant = _getInvariant(tokens, _weights(tokens), balances);
        uint256 ratio = _lastInvariant.div(currentInvariant);

        (IERC20 token, uint256 index) = UnsafeRandom.rand(tokens);
        uint256 exponent = FixedPoint.ONE.div(_normalizedWeight(token));
        swapFeesCollected[index] = balances[index].mul(uint256(FixedPoint.ONE).sub(LogExpMath.pow(ratio, exponent)));
        return swapFeesCollected;
    }

    function _resetAccumulatedSwapFees(
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256[] memory balances
    ) internal {
        _lastInvariant = _getInvariant(tokens, weights, balances);
    }

    function _getInvariant(
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256[] memory balances
    ) private view returns (uint256) {
        uint256[] memory normalizedWeights = new uint256[](tokens.length);
        for (uint8 i = 0; i < tokens.length; i++) {
            normalizedWeights[i] = weights[i].div(_sumWeights);
        }
        return _invariant(normalizedWeights, balances);
    }

    // Pays protocol swap fees
    function payProtocolFees() external nonReentrant {
        (IERC20[] memory tokens, uint256[] memory balances) = _getPoolTokenBalances();
        balances = _payProtocolFees(tokens, balances);
        _resetAccumulatedSwapFees(tokens, _weights(tokens), balances);
    }

    //Join / Exit

    function joinPool(
        uint256 poolAmountOut,
        uint256[] calldata maxAmountsIn,
        bool transferTokens,
        address beneficiary
    ) external override nonReentrant {
        (IERC20[] memory tokens, uint256[] memory balances) = _getPoolTokenBalances();
        require(maxAmountsIn.length == tokens.length, "Tokens and amounts length mismatch");

        //Pay protocol fees to have balances up to date
        balances = _payProtocolFees(tokens, balances);

        uint256 ratio = _getSupplyRatio(poolAmountOut);
        uint256[] memory amountsIn = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 amount = balances[i].mul(ratio);
            require(amount <= maxAmountsIn[i], "ERR_LIMIT_IN");

            amountsIn[i] = amount;
            balances[i] = balances[i].add(amount);
        }

        _vault.addLiquidity(_poolId, msg.sender, tokens, amountsIn, !transferTokens);

        // Reset swap fees counter
        _resetAccumulatedSwapFees(tokens, _weights(tokens), balances);

        _mintPoolTokens(beneficiary, poolAmountOut);
    }

    function exitPool(
        uint256 poolAmountIn,
        uint256[] calldata minAmountsOut,
        bool withdrawTokens,
        address beneficiary
    ) external override nonReentrant {
        (IERC20[] memory tokens, uint256[] memory balances) = _getPoolTokenBalances();
        require(minAmountsOut.length == tokens.length, "Tokens and amounts length mismatch");

        //Pay protocol fees to have balances up to date
        balances = _payProtocolFees(tokens, balances);

        uint256 ratio = _getSupplyRatio(poolAmountIn);
        uint256[] memory amountsOut = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 amount = balances[i].mul(ratio);
            require(amount >= minAmountsOut[i], "NOT EXITING ENOUGH");

            amountsOut[i] = amount;
            balances[i] = balances[i].sub(amount);
        }

        _vault.removeLiquidity(_poolId, beneficiary, tokens, amountsOut, !withdrawTokens);

        //Reset swap fees counter
        _resetAccumulatedSwapFees(tokens, _weights(tokens), balances);

        _burnPoolTokens(msg.sender, poolAmountIn);
    }

    /**
     * @dev Called by liquidity providers to join the associated Pool, adding `tokens` and getting BPT in return. The
     * caller specifies how much of each token they want to add `amountsIn`, and the minimum amount
     * of BPT they want to get `minBPTAmountOut`
     *
     * If `transferTokens` is true, the Vault will pull tokens from the caller's account, who must have granted it
     * allowance. Otherwise, they are pulled from the User's Internal Balance.
     *
     * `bptAmountOut` will be minted and transferred to `beneficiary`.
     */

    function joinPoolExactTokensInForBPTOut(
        uint256 minBPTAmountOut,
        uint256[] calldata amountsIn,
        bool transferTokens,
        address beneficiary
    ) external nonReentrant returns (uint256 bptAmountOut) {
        IERC20[] memory tokens = _vault.getPoolTokens(_poolId);
        require(tokens.length == _totalTokens, "ERR_EMPTY_POOL");

        uint256[] memory balances = _vault.getPoolTokenBalances(_poolId, tokens);

        require(amountsIn.length == tokens.length, "AmountsIn and tokens length mismatch");

        //Pay protocol fees to have balances up to date
        uint256[] memory swapFeesCollected = _getAccumulatedSwapFees(tokens, balances);
        balances = _vault.paySwapProtocolFees(_poolId, tokens, swapFeesCollected);

        uint256[] memory normalizedWeights = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            normalizedWeights[i] = _normalizedWeight(tokens[i]);
        }

        bptAmountOut = _exactTokensInForBPTOut(balances, normalizedWeights, amountsIn, totalSupply(), _swapFee);
        require(bptAmountOut >= minBPTAmountOut, "ERR_BPT_OUT_MIN_AMOUNT");

        /*
        // TODO for Oracle/MLP integration
        // If this pool is an oracle candidate then update balancesBeforeLastLiquidityChange
        if(_optInOracleCandidate || _mandatoryOracleCandidate)
                updateBalancesBeforeLastLiquidityChange(balances);
        */

        _vault.addLiquidity(_poolId, msg.sender, tokens, amountsIn, !transferTokens);

        //Update balances
        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = balances[i].add(amountsIn[i]);
        }

        //Reset swap fees counter
        _resetAccumulatedSwapFees(tokens, _weights(tokens), balances);

        _mintPoolTokens(beneficiary, bptAmountOut);
    }

    /**
     * @dev Called by liquidity providers to join the associated Pool, adding `token` and getting BPT in return. The
     * caller specifies how much BPTOut they want `BPTAmountOut`, and the maximum amount
     * of token they want to pay `maxAmountIn`
     *
     * If `transferTokens` is true, the Vault will pull tokens from the caller's account, who must have granted it
     * allowance. Otherwise, they are pulled from the User's Internal Balance.
     *
     * `BPTAmountOut` will be minted and transferred to `beneficiary`.
     */

    function joinPoolTokenInForExactBPTOut(
        uint256 bptAmountOut,
        IERC20 token,
        uint256 maxAmountIn,
        bool transferTokens,
        address beneficiary
    ) external nonReentrant returns (uint256) {
        IERC20[] memory tokens = _vault.getPoolTokens(_poolId);
        require(tokens.length == _totalTokens, "ERR_EMPTY_POOL");

        uint256[] memory balances = _vault.getPoolTokenBalances(_poolId, tokens);

        //Pay protocol fees to have balances up to date
        uint256[] memory swapFeesCollected = _getAccumulatedSwapFees(tokens, balances);
        balances = _vault.paySwapProtocolFees(_poolId, tokens, swapFeesCollected);

        IERC20[] memory tokensToAdd = new IERC20[](1);
        uint256[] memory amountsToAdd = new uint256[](1);
        uint256 tokenBalance;
        uint256 tokenNormalizedWeight;
        for (uint256 i = 0; i < tokens.length; ++i) {
            if (tokens[i] == token) {
                tokensToAdd[0] = token;
                tokenBalance = balances[i];
                tokenNormalizedWeight = _normalizedWeight(tokens[i]);
                break;
            }
        }
        require(tokenBalance != 0, "TOKEN_NOT_IN_POOL");

        amountsToAdd[0] = _tokenInForExactBPTOut(
            tokenBalance,
            tokenNormalizedWeight,
            bptAmountOut,
            totalSupply(),
            _swapFee
        );
        require(amountsToAdd[0] <= maxAmountIn, "ERR_TOKEN_IN_MAX_AMOUNT");

        /*
        // TODO for Oracle/MLP integration
        // If this pool is an oracle candidate then update balancesBeforeLastLiquidityChange
        if(_optInOracleCandidate || _mandatoryOracleCandidate)
                updateBalancesBeforeLastLiquidityChange(balances);
        */

        _vault.addLiquidity(_poolId, msg.sender, tokensToAdd, amountsToAdd, !transferTokens);

        _mintPoolTokens(beneficiary, bptAmountOut);

        //Update balance
        balances[0] = balances[0].add(amountsToAdd[0]);

        //Reset swap fees counter
        _resetAccumulatedSwapFees(tokens, _weights(tokens), balances);

        return amountsToAdd[0];
    }

    /**
     * @dev Called by liquidity providers to exit the associated Pool, receiving `tokens` in exchange for
     *  BPT in return. The caller specifies for each token how much in BTP they want to redeem: `BPTAmountsIn`
     *  and the minimum amount for each token they want to get `minAmountsOut`
     *
     * If `transferTokens` is true, the Vault will pull tokens from the caller's account, who must have granted it
     * allowance. Otherwise, they are pulled from the User's Internal Balance.
     *
     * `tokens` -> list of tokens that user wants to receive
     * `BPTAmountsIn` -> list with the amounts of BPT that are going to be redeemed for each token in `tokens`
     * `minAmountsOut` -> the minimum amount of each token the user requires to receive
     */

    function exitPoolExactBPTInForTokenOut(
        uint256 bptAmountIn,
        IERC20 token,
        uint256 minAmountOut,
        bool transferTokens,
        address beneficiary
    ) public nonReentrant returns (uint256) {
        IERC20[] memory tokens = _vault.getPoolTokens(_poolId);
        require(tokens.length == _totalTokens, "ERR_EMPTY_POOL");

        uint256[] memory balances = _vault.getPoolTokenBalances(_poolId, tokens);

        //Pay protocol fees to have balances up to date
        uint256[] memory swapFeesCollected = _getAccumulatedSwapFees(tokens, balances);
        balances = _vault.paySwapProtocolFees(_poolId, tokens, swapFeesCollected);

        IERC20[] memory tokensToRemove = new IERC20[](1);
        uint256[] memory amountsToRemove = new uint256[](1);
        uint256 tokenBalance;
        uint256 tokenNormalizedWeight;
        for (uint256 i = 0; i < tokens.length; ++i) {
            if (tokens[i] == token) {
                tokensToRemove[0] = token;
                tokenBalance = balances[i];
                tokenNormalizedWeight = _normalizedWeight(tokens[i]);
                break;
            }
        }
        require(tokenBalance != 0, "TOKEN_NOT_IN_POOL");

        amountsToRemove[0] = _exactBPTInForTokenOut(
            tokenBalance,
            tokenNormalizedWeight,
            bptAmountIn,
            totalSupply(),
            _swapFee
        );
        require(amountsToRemove[0] >= minAmountOut, "ERR_TOKEN_OUT_MIN_AMOUNT");

        /*
        // TODO for Oracle/MLP integration
        // If this pool is an oracle candidate then update balancesBeforeLastLiquidityChange
        if(_optInOracleCandidate || _mandatoryOracleCandidate)
                updateBalancesBeforeLastLiquidityChange(balances);
        */

        _vault.removeLiquidity(_poolId, beneficiary, tokensToRemove, amountsToRemove, !transferTokens);

        //Update balance
        balances[0] = balances[0].sub(amountsToRemove[0]);

        //Reset swap fees counter
        _resetAccumulatedSwapFees(tokens, _weights(tokens), balances);

        _burnPoolTokens(msg.sender, bptAmountIn);

        return amountsToRemove[0];
    }

    /**
     * @dev Called by liquidity providers to exit the associated Pool, receiving `tokens` in exchange for
     *  BPT in return. The caller specifies how much of each token they want to receive: `amountsOut`
     *  and the maximum amount of BPT they want to redeem `maxBPTAmountIn`
     *
     * If `transferTokens` is true, the Vault will pull tokens from the caller's account, who must have granted it
     * allowance. Otherwise, they are pulled from the User's Internal Balance.
     *
     * `tokens` -> list of tokens that user wants to receive
     * `amountsOut` -> list with the amounts of each token the user wants to receive
     * `maxBPTAmountIn` -> the maximum amount of BPT the user wants to redeem
     */

    function exitPoolBPTInForExactTokensOut(
        uint256 maxBPTAmountIn,
        uint256[] calldata amountsOut,
        bool transferTokens,
        address beneficiary
    ) public nonReentrant returns (uint256 bptAmountIn) {
        IERC20[] memory tokens = _vault.getPoolTokens(_poolId);
        require(tokens.length == _totalTokens, "ERR_EMPTY_POOL");

        uint256[] memory balances = _vault.getPoolTokenBalances(_poolId, tokens);

        require(amountsOut.length == tokens.length, "AmountsOut and tokens length mismatch");

        //Pay protocol fees to have balances up to date
        uint256[] memory swapFeesCollected = _getAccumulatedSwapFees(tokens, balances);
        balances = _vault.paySwapProtocolFees(_poolId, tokens, swapFeesCollected);

        uint256[] memory normalizedWeights = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            normalizedWeights[i] = _normalizedWeight(tokens[i]);
        }

        bptAmountIn = _bptInForExactTokensOut(balances, normalizedWeights, amountsOut, totalSupply(), _swapFee);
        require(bptAmountIn <= maxBPTAmountIn, "ERR_BPT_IN_MAX_AMOUNT");

        /*
        // TODO for Oracle/MLP integration
        // If this pool is an oracle candidate then update balancesBeforeLastLiquidityChange
        if(_optInOracleCandidate || _mandatoryOracleCandidate)
                updateBalancesBeforeLastLiquidityChange(balances);
        */

        _vault.removeLiquidity(_poolId, beneficiary, tokens, amountsOut, !transferTokens);

        //Update balances
        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = balances[i].sub(amountsOut[i]);
        }

        //Reset swap fees counter
        _resetAccumulatedSwapFees(tokens, _weights(tokens), balances);

        _burnPoolTokens(msg.sender, bptAmountIn);

        return bptAmountIn;
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

    function _getPoolTokenBalances() internal view returns (IERC20[] memory tokens, uint256[] memory balances) {
        tokens = _vault.getPoolTokens(_poolId);
        // We trust the number of tokens returned from the Vault since these are registered in the constructor

        balances = _vault.getPoolTokenBalances(_poolId, tokens);
        bool someLiquidity = true;
        for (uint256 i = 0; i < tokens.length && someLiquidity; i++) {
            someLiquidity = balances[i] != 0;
        }

        require(someLiquidity, "ERR_ZERO_LIQUIDITY");
    }
}
