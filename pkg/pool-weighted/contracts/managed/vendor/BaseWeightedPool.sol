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

import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";

import "../../lib/WeightedExitsLib.sol";
import "../../lib/WeightedJoinsLib.sol";
import "../../WeightedMath.sol";

import "./BaseMinimalSwapInfoPool.sol";

/**
 * @dev Base class for WeightedPools containing swap, join and exit logic, but leaving storage and management of
 * the weights to subclasses. Derived contracts can choose to make weights immutable, mutable, or even dynamic
 *  based on local or external logic.
 */
abstract contract BaseWeightedPool is BaseMinimalSwapInfoPool {
    using FixedPoint for uint256;
    using WeightedPoolUserData for bytes;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        bool mutableTokens
    )
        BasePool(
            vault,
            // Given BaseMinimalSwapInfoPool supports both of these specializations, and this Pool never registers
            // or deregisters any tokens after construction, picking Two Token when the Pool only has two tokens is free
            // gas savings.
            // If the pool is expected to be able register new tokens in future, we must choose MINIMAL_SWAP_INFO
            // as clearly the TWO_TOKEN specification doesn't support adding extra tokens in future.
            tokens.length == 2 && !mutableTokens
                ? IVault.PoolSpecialization.TWO_TOKEN
                : IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
            name,
            symbol,
            tokens,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Virtual functions

    /**
     * @dev Returns the normalized weight of `token`. Weights are fixed point numbers that sum to FixedPoint.ONE.
     */
    function _getNormalizedWeight(IERC20 token) internal view virtual returns (uint256);

    /**
     * @dev Returns all normalized weights, in the same order as the Pool's tokens.
     */
    function _getNormalizedWeights() internal view virtual returns (uint256[] memory);

    /**
     * @dev Returns the current value of the invariant.
     */
    function getInvariant() public view returns (uint256) {
        (, uint256[] memory balances, ) = getVault().getPoolTokens(getPoolId());

        // Since the Pool hooks always work with upscaled balances, we manually
        // upscale here for consistency
        _upscaleArray(balances, _scalingFactors());

        uint256[] memory normalizedWeights = _getNormalizedWeights();
        return WeightedMath._calculateInvariant(normalizedWeights, balances);
    }

    function getNormalizedWeights() external view returns (uint256[] memory) {
        return _getNormalizedWeights();
    }

    // Base Pool handlers

    /**
     * @dev Called before any join or exit operation. Returns the Pool's total supply by default, but derived contracts
     * may choose to add custom behavior at these steps. This often has to do with protocol fee processing.
     */
    function _beforeJoinExit(uint256[] memory preBalances, uint256[] memory normalizedWeights)
        internal
        virtual
        returns (uint256);

    // Initialize

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal virtual override returns (uint256, uint256[] memory) {
        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, scalingFactors.length);
        _upscaleArray(amountsIn, scalingFactors);

        uint256[] memory normalizedWeights = _getNormalizedWeights();
        uint256 invariantAfterJoin = WeightedMath._calculateInvariant(normalizedWeights, amountsIn);

        // Set the initial BPT to the value of the invariant times the number of tokens. This makes BPT supply more
        // consistent in Pools with similar compositions but different number of tokens.
        uint256 bptAmountOut = Math.mul(invariantAfterJoin, amountsIn.length);

        return (bptAmountOut, amountsIn);
    }

    // Join

    function _onJoinPool(
        bytes32,
        address sender,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal virtual override returns (uint256, uint256[] memory) {
        uint256[] memory normalizedWeights = _getNormalizedWeights();

        uint256 preJoinExitSupply = _beforeJoinExit(balances, normalizedWeights);

        (uint256 bptAmountOut, uint256[] memory amountsIn) = _doJoin(
            sender,
            balances,
            normalizedWeights,
            scalingFactors,
            preJoinExitSupply,
            userData
        );

        return (bptAmountOut, amountsIn);
    }

    /**
     * @dev Dispatch code which decodes the provided userdata to perform the specified join type.
     * Inheriting contracts may override this function to add additional join types or extra conditions to allow
     * or disallow joins under certain circumstances.
     */
    function _doJoin(
        address,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData
    ) internal view virtual returns (uint256, uint256[] memory) {
        WeightedPoolUserData.JoinKind kind = userData.joinKind();

        if (kind == WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return
                WeightedJoinsLib.joinExactTokensInForBPTOut(
                    balances,
                    normalizedWeights,
                    scalingFactors,
                    totalSupply,
                    getSwapFeePercentage(),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return
                WeightedJoinsLib.joinTokenInForExactBPTOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    getSwapFeePercentage(),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return WeightedJoinsLib.joinAllTokensInForExactBPTOut(balances, totalSupply, userData);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    // Exit

    function _onExitPool(
        bytes32,
        address sender,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal virtual override returns (uint256, uint256[] memory) {
        uint256[] memory normalizedWeights = _getNormalizedWeights();

        uint256 preJoinExitSupply = _beforeJoinExit(balances, normalizedWeights);

        (uint256 bptAmountIn, uint256[] memory amountsOut) = _doExit(
            sender,
            balances,
            normalizedWeights,
            scalingFactors,
            preJoinExitSupply,
            userData
        );

        return (bptAmountIn, amountsOut);
    }

    /**
     * @dev Dispatch code which decodes the provided userdata to perform the specified exit type.
     * Inheriting contracts may override this function to add additional exit types or extra conditions to allow
     * or disallow exit under certain circumstances.
     */
    function _doExit(
        address,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData
    ) internal view virtual returns (uint256, uint256[] memory) {
        WeightedPoolUserData.ExitKind kind = userData.exitKind();

        if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return
                WeightedExitsLib.exitExactBPTInForTokenOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    getSwapFeePercentage(),
                    userData
                );
        } else if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            return WeightedExitsLib.exitExactBPTInForTokensOut(balances, totalSupply, userData);
        } else if (kind == WeightedPoolUserData.ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            return
                WeightedExitsLib.exitBPTInForExactTokensOut(
                    balances,
                    normalizedWeights,
                    scalingFactors,
                    totalSupply,
                    getSwapFeePercentage(),
                    userData
                );
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }
    }
}
