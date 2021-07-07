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

import "@balancer-labs/v2-pool-utils/contracts/interfaces/IPriceOracle.sol";
import "@balancer-labs/v2-pool-utils/contracts/oracle/PoolPriceOracle.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/LogCompression.sol";

import "../StablePool.sol";
import "./OracleMiscData.sol";
import "./StableOracleMath.sol";

contract MetaStablePool is StablePool, StableOracleMath, PoolPriceOracle, IPriceOracle {
    using OracleMiscData for bytes32;

    event OracleEnabledChanged(bool enabled);

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 amplificationParameter,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        bool oracleEnabled,
        address owner
    )
        StablePool(
            vault,
            name,
            symbol,
            tokens,
            amplificationParameter,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _require(tokens.length == 2, Errors.NOT_TWO_TOKENS);
        _setOracleEnabled(oracleEnabled);
    }

    // Swap

    /**
     * Update price oracle with the pre-swap balances
     * Note this function does not perform any safety checks about swaps, it relies on upper implementations for that.
     */
    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override whenNotPaused returns (uint256) {
        _updateOracle(request.lastChangeBlock, balances[0], balances[1]);
        return super._onSwapGivenIn(request, balances, indexIn, indexOut);
    }

    /**
     * Update price oracle with the pre-swap balances
     * Note this function does not perform any safety checks about swaps, it relies on upper implementations for that.
     */
    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256) {
        _updateOracle(request.lastChangeBlock, balances[0], balances[1]);
        return super._onSwapGivenOut(request, balances, indexIn, indexOut);
    }

    // Join

    /**
     * @dev Update cached total supply and invariant using the results after the join that will be used for
     * future oracle updates.
     * Note this function does not perform any safety checks about joins, it relies on upper implementations for that.
     */
    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) {
        (amountsIn, dueProtocolFeeAmounts) = super.onJoinPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        _cacheInvariantAndSupply();
    }

    /**
     * @dev Update price oracle with the pre-join balances
     */
    function _onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
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
        _updateOracle(lastChangeBlock, balances[0], balances[1]);

        return
            super._onJoinPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                protocolSwapFeePercentage,
                scalingFactors,
                userData
            );
    }

    // Exit

    /**
     * @dev Update cached total supply and invariant using the results after the exit that will be used for
     * future oracle updates.
     * Note this function does not perform any safety checks about exits, it relies on upper implementations for that.
     */
    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) {
        (amountsOut, dueProtocolFeeAmounts) = super.onExitPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        // If the contract is paused, avoid updating the oracle to minimize code paths taken.
        if (_isNotPaused()) {
            _cacheInvariantAndSupply();
        }
    }

    /**
     * @dev Update price oracle with the pre-exit balances
     */
    function _onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        // If the contract is paused, swap protocol fee amounts are not charged and the oracle is not updated
        // to avoid extra calculations and reduce the potential for errors.
        if (_isNotPaused()) {
            _updateOracle(lastChangeBlock, balances[0], balances[1]);
        }

        return
            super._onExitPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                protocolSwapFeePercentage,
                scalingFactors,
                userData
            );
    }

    // Oracle

    function getOracleMiscData()
        external
        view
        returns (
            int256 logInvariant,
            int256 logTotalSupply,
            uint256 oracleSampleCreationTimestamp,
            uint256 oracleIndex,
            bool oracleEnabled
        )
    {
        bytes32 miscData = _getMiscData();
        logInvariant = miscData.logInvariant();
        logTotalSupply = miscData.logTotalSupply();
        oracleSampleCreationTimestamp = miscData.oracleSampleCreationTimestamp();
        oracleIndex = miscData.oracleIndex();
        oracleEnabled = miscData.oracleEnabled();
    }

    /**
     * @dev Balancer Governance can always enable the Oracle, even if it was originally not enabled. This allows for
     * Pools that unexpectedly drive much more volume and liquidity than expected to serve as Price Oracles.
     *
     * Note that the Oracle can only be enabled - it can never be disabled.
     */
    function enableOracle() external whenNotPaused authenticate {
        _setOracleEnabled(true);

        // Cache log invariant and supply only if the pool was initialized
        if (totalSupply() > 0) {
            _cacheInvariantAndSupply();
        }
    }

    function _setOracleEnabled(bool enabled) internal {
        _setMiscData(_getMiscData().setOracleEnabled(enabled));
        emit OracleEnabledChanged(enabled);
    }

    function getLargestSafeQueryWindow() external pure override returns (uint256) {
        return 34 hours;
    }

    function getLatest(Variable variable) external view override returns (uint256) {
        int256 instantValue = _getInstantValue(variable, _getMiscData().oracleIndex());
        return LogCompression.fromLowResLog(instantValue);
    }

    function getTimeWeightedAverage(OracleAverageQuery[] memory queries)
        external
        view
        override
        returns (uint256[] memory results)
    {
        results = new uint256[](queries.length);
        uint256 oracleIndex = _getMiscData().oracleIndex();

        OracleAverageQuery memory query;
        for (uint256 i = 0; i < queries.length; ++i) {
            query = queries[i];
            _require(query.secs != 0, Errors.ORACLE_BAD_SECS);

            int256 beginAccumulator = _getPastAccumulator(query.variable, oracleIndex, query.ago + query.secs);
            int256 endAccumulator = _getPastAccumulator(query.variable, oracleIndex, query.ago);
            results[i] = LogCompression.fromLowResLog((endAccumulator - beginAccumulator) / int256(query.secs));
        }
    }

    function getPastAccumulators(OracleAccumulatorQuery[] memory queries)
        external
        view
        override
        returns (int256[] memory results)
    {
        results = new int256[](queries.length);
        uint256 oracleIndex = _getMiscData().oracleIndex();

        OracleAccumulatorQuery memory query;
        for (uint256 i = 0; i < queries.length; ++i) {
            query = queries[i];
            results[i] = _getPastAccumulator(query.variable, oracleIndex, query.ago);
        }
    }

    /**
     * @dev Updates the Price Oracle based on the Pool's current state (balances, BPT supply and invariant). Must be
     * called on *all* state-changing functions with the balances *before* the state change happens, and with
     * `lastChangeBlock` as the number of the block in which any of the balances last changed.
     */
    function _updateOracle(
        uint256 lastChangeBlock,
        uint256 balance0,
        uint256 balance1
    ) internal {
        bytes32 miscData = _getMiscData();
        (uint256 currentAmp, ) = _getAmplificationParameter();

        if (miscData.oracleEnabled() && block.number > lastChangeBlock) {
            (int256 logSpotPrice, int256 logBptPrice) = StableOracleMath._calcLogPrices(
                currentAmp,
                balance0,
                balance1,
                miscData.logTotalSupply()
            );

            uint256 oracleCurrentIndex = miscData.oracleIndex();
            uint256 oracleCurrentSampleInitialTimestamp = miscData.oracleSampleCreationTimestamp();
            uint256 oracleUpdatedIndex = _processPriceData(
                oracleCurrentSampleInitialTimestamp,
                oracleCurrentIndex,
                logSpotPrice,
                logBptPrice,
                miscData.logInvariant()
            );

            if (oracleCurrentIndex != oracleUpdatedIndex) {
                // solhint-disable not-rely-on-time
                miscData = miscData.setOracleIndex(oracleUpdatedIndex);
                miscData = miscData.setOracleSampleCreationTimestamp(block.timestamp);
                _setMiscData(miscData);
            }
        }
    }

    /**
     * @dev Stores the logarithm of the invariant and BPT total supply, to be later used in each oracle update. Because
     * it is stored in miscData, which is read in all operations (including swaps), this saves gas by not requiring to
     * compute or read these values when updating the oracle.
     *
     * This function must be called by all actions that update the invariant and BPT supply (joins and exits). Swaps
     * also alter the invariant due to collected swap fees, but this growth is considered negligible and not accounted
     * for.
     */
    function _cacheInvariantAndSupply() internal {
        bytes32 miscData = _getMiscData();
        if (miscData.oracleEnabled()) {
            miscData = miscData.setLogInvariant(LogCompression.toLowResLog(_lastInvariant));
            miscData = miscData.setLogTotalSupply(LogCompression.toLowResLog(totalSupply()));
            _setMiscData(miscData);
        }
    }
}
