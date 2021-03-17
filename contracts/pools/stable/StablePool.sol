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

import "../../lib/math/FixedPoint.sol";
import "../../lib/helpers/InputHelpers.sol";
import "../../lib/helpers/UnsafeRandom.sol";

import "../BaseGeneralPool.sol";

import "./StableMath.sol";
import "./StablePoolUserDataHelpers.sol";

contract StablePool is BaseGeneralPool, StableMath {
    using FixedPoint for uint256;
    using StablePoolUserDataHelpers for bytes;

    uint256 private immutable _amp;

    uint256 private _lastInvariant;

    enum JoinKind { INIT, ALL_TOKENS_IN_FOR_EXACT_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT }

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 amp,
        uint256 swapFee,
        uint256 emergencyPeriod,
        uint256 emergencyPeriodCheckExtension
    ) BaseGeneralPool(vault, name, symbol, tokens, swapFee, emergencyPeriod, emergencyPeriodCheckExtension) {
        require(amp >= _MIN_AMP, "MIN_AMP");
        require(amp <= _MAX_AMP, "MAX_AMP");
        _amp = amp;
    }

    function getAmplification() external view returns (uint256) {
        return _amp;
    }

    // Base Pool handlers

    // Swap

    function _onSwapGivenIn(
        IPoolSwapStructs.SwapRequestGivenIn memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view virtual override noEmergencyPeriod returns (uint256) {
        return StableMath._outGivenIn(_amp, balances, indexIn, indexOut, swapRequest.amountIn);
    }

    function _onSwapGivenOut(
        IPoolSwapStructs.SwapRequestGivenOut memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view virtual override noEmergencyPeriod returns (uint256) {
        return StableMath._inGivenOut(_amp, balances, indexIn, indexOut, swapRequest.amountOut);
    }

    // Initialize

    function _onInitializePool(
        bytes32,
        address,
        address,
        bytes memory userData
    ) internal virtual override noEmergencyPeriod returns (uint256, uint256[] memory) {
        StablePool.JoinKind kind = userData.joinKind();
        require(kind == StablePool.JoinKind.INIT, "UNINITIALIZED");

        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, _totalTokens);
        _upscaleArray(amountsIn, _scalingFactors());

        uint256 invariantAfterJoin = StableMath._invariant(_amp, amountsIn);
        uint256 bptAmountOut = invariantAfterJoin;

        _lastInvariant = invariantAfterJoin;

        return (bptAmountOut, amountsIn);
    }

    // Join

    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory currentBalances,
        uint256,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        internal
        virtual
        override
        noEmergencyPeriod
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        // Due protocol swap fees are computed by measuring the growth of the invariant from the previous join or exit
        // event and now - the invariant's growth is due exclusively to swap fees.
        uint256[] memory dueProtocolFeeAmounts = _getDueProtocolFeeAmounts(
            currentBalances,
            _lastInvariant,
            protocolSwapFeePercentage
        );

        // Update the balances by subtracting the protocol fees that will be charged by the Vault once this function
        // returns.
        for (uint256 i = 0; i < _totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].sub(dueProtocolFeeAmounts[i]);
        }

        (uint256 bptAmountOut, uint256[] memory amountsIn) = _doJoin(currentBalances, userData);

        // Update the invariant with the balances the Pool will have after the join, in order to compute the due
        // protocol swap fees in future joins and exits.
        _lastInvariant = _invariantAfterJoin(currentBalances, amountsIn);

        return (bptAmountOut, amountsIn, dueProtocolFeeAmounts);
    }

    function _doJoin(uint256[] memory currentBalances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        JoinKind kind = userData.joinKind();

        if (kind == JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return _joinAllTokensInForExactBPTOut(currentBalances, userData);
        } else {
            revert("UNHANDLED_JOIN_KIND");
        }
    }

    function _joinAllTokensInForExactBPTOut(uint256[] memory currentBalances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        uint256 bptAmountOut = userData.allTokensInForExactBptOut();

        uint256[] memory amountsIn = StableMath._allTokensInForExactBPTOut(
            currentBalances,
            bptAmountOut,
            totalSupply()
        );

        return (bptAmountOut, amountsIn);
    }

    // Exit

    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory currentBalances,
        uint256,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        internal
        virtual
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        // Due protocol swap fees are computed by measuring the growth of the invariant from the previous join or exit
        // event and now - the invariant's growth is due exclusively to swap fees.
        uint256[] memory dueProtocolFeeAmounts = _getDueProtocolFeeAmounts(
            currentBalances,
            _lastInvariant,
            protocolSwapFeePercentage
        );

        // Update the balances by subtracting the protocol fees that will be charged by the Vault once this function
        // returns.
        for (uint256 i = 0; i < _totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].sub(dueProtocolFeeAmounts[i]);
        }

        (uint256 bptAmountIn, uint256[] memory amountsOut) = _doExit(currentBalances, userData);

        // Update the invariant with the balances the Pool will have after the exit, in order to compute the due
        // protocol swap fees in future joins and exits.
        _lastInvariant = _invariantAfterExit(currentBalances, amountsOut);

        return (bptAmountIn, amountsOut, dueProtocolFeeAmounts);
    }

    function _doExit(uint256[] memory currentBalances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        ExitKind kind = userData.exitKind();

        if (kind == ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return _exitExactBPTInForAllTokensOut(currentBalances, userData);
        } else {
            revert("UNHANDLED_EXIT_KIND");
        }
    }

    /**
     * @dev Note we are not tagging this function with `noEmergencyPeriod` to allow users exit in a proportional
     * manner in case there is an emergency in the pool. This operation should never be restricted.
     */
    function _exitExactBPTInForAllTokensOut(uint256[] memory currentBalances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        uint256 bptAmountIn = userData.exactBptInForAllTokensOut();

        uint256[] memory amountsOut = StableMath._exactBPTInForAllTokensOut(
            currentBalances,
            bptAmountIn,
            totalSupply()
        );

        return (bptAmountIn, amountsOut);
    }

    // Helpers

    function _getDueProtocolFeeAmounts(
        uint256[] memory currentBalances,
        uint256 previousInvariant,
        uint256 protocolSwapFeePercentage
    ) private view returns (uint256[] memory) {
        // Instead of paying the protocol swap fee in all tokens proportionally, we will pay it in a single one. This
        // will reduce gas costs for single asset joins and exits, as at most only two Pool balances will change (the
        // token joined/exited, and the token in which fees will be paid).

        // The token fees is paid in is chosen pseudo-randomly, with the hope to achieve a uniform distribution across
        // multiple joins and exits. This pseudo-randomness being manipulated is not an issue.
        uint256 chosenTokenIndex = UnsafeRandom.rand(_totalTokens);

        // Initialize with zeros
        uint256[] memory dueProtocolFeeAmounts = new uint256[](_totalTokens);
        // Set the fee to pay in the selected token
        dueProtocolFeeAmounts[chosenTokenIndex] = StableMath._calculateDueTokenProtocolSwapFee(
            _amp,
            currentBalances,
            previousInvariant,
            chosenTokenIndex,
            protocolSwapFeePercentage
        );

        return dueProtocolFeeAmounts;
    }

    function _invariantAfterJoin(uint256[] memory currentBalances, uint256[] memory amountsIn)
        private
        view
        returns (uint256)
    {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].add(amountsIn[i]);
        }

        return StableMath._invariant(_amp, currentBalances);
    }

    function _invariantAfterExit(uint256[] memory currentBalances, uint256[] memory amountsOut)
        private
        view
        returns (uint256)
    {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].sub(amountsOut[i]);
        }

        return StableMath._invariant(_amp, currentBalances);
    }
}
