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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/LogCompression.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "@balancer-labs/v2-pool-utils/contracts/oracle/PoolPriceOracle.sol";

import "./BaseWeightedPool.sol";
import "./WeightedOracleMath.sol";

contract WeightedPool2Tokens is BaseWeightedPool, PoolPriceOracle, WeightedOracleMath {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    // Use BasePool's _miscData storage
    // [ reserved  | oracle enabled | oracle index | oracle sample initial timestamp | log supply | log invariant ]
    // [  uint64   |      bool      |    uint10    |              uint31             |    int22   |     int22     ]
    // |MSB                                                                                                    LSB|
    uint256 private constant _LOG_INVARIANT_OFFSET = 0;
    uint256 private constant _LOG_TOTAL_SUPPLY_OFFSET = 22;
    uint256 private constant _ORACLE_SAMPLE_CREATION_TIMESTAMP_OFFSET = 44;
    uint256 private constant _ORACLE_INDEX_OFFSET = 75;
    uint256 private constant _ORACLE_ENABLED_OFFSET = 85;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;

    uint256 private immutable _normalizedWeight0;
    uint256 private immutable _normalizedWeight1;

    // The protocol fees will always be charged using the token associated with the max weight in the pool.
    // Since these Pools will register tokens only once, we can assume this index will be constant.
    uint256 private immutable _maxWeightTokenIndex;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;

    event OracleEnabledChanged(bool enabled);

    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        uint256 normalizedWeight0;
        uint256 normalizedWeight1;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        bool oracleEnabled;
        address owner;
    }

    constructor(NewPoolParams memory params)
        BaseWeightedPool(
            params.vault,
            params.name,
            params.symbol,
            params.tokens,
            new address[](2), // No asset managers
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        _require(params.tokens.length == 2, Errors.TOKENS_LENGTH_MUST_BE_2);
        // Ensure each normalized weight is above them minimum and find the token index of the maximum weight
        _require(params.normalizedWeight0 >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);
        _require(params.normalizedWeight1 >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

        // Ensure that the normalized weights sum to ONE
        uint256 normalizedSum = params.normalizedWeight0.add(params.normalizedWeight1);
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _token0 = params.tokens[0];
        _token1 = params.tokens[1];

        _scalingFactor0 = _computeScalingFactor(params.tokens[0]);
        _scalingFactor1 = _computeScalingFactor(params.tokens[1]);

        _normalizedWeight0 = params.normalizedWeight0;
        _normalizedWeight1 = params.normalizedWeight1;

        _maxWeightTokenIndex = params.normalizedWeight0 >= params.normalizedWeight1 ? 0 : 1;

        _setOracleEnabled(params.oracleEnabled);
    }

    // Getters / Setters

    function getMiscData()
        external
        view
        returns (
            int256 logInvariant,
            int256 logTotalSupply,
            uint256 oracleSampleCreationTimestamp,
            uint256 oracleIndex,
            bool oracleEnabled,
            uint256 swapFeePercentage
        )
    {
        bytes32 miscData = _getMiscData();

        logInvariant = miscData.decodeInt22(_LOG_INVARIANT_OFFSET);
        logTotalSupply = miscData.decodeInt22(_LOG_TOTAL_SUPPLY_OFFSET);
        oracleSampleCreationTimestamp = miscData.decodeUint31(_ORACLE_SAMPLE_CREATION_TIMESTAMP_OFFSET);
        oracleIndex = miscData.decodeUint10(_ORACLE_INDEX_OFFSET);
        oracleEnabled = miscData.decodeBool(_ORACLE_ENABLED_OFFSET);

        // BasePool's miscData is only the least significant 192 bits - the swap fee percentage is stored
        // in the "reserved" portion of that bytes32 value, so we need to retrieve it with a separate call
        swapFeePercentage = getSwapFeePercentage();
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
        _setMiscData(_getMiscData().insertBool(enabled, _ORACLE_ENABLED_OFFSET));
        emit OracleEnabledChanged(enabled);
    }

    function _getNormalizedWeights() internal view virtual override returns (uint256[] memory) {
        uint256[] memory normalizedWeights = new uint256[](2);
        normalizedWeights[0] = _normalizedWeight0;
        normalizedWeights[1] = _normalizedWeight1;
        return normalizedWeights;
    }

    function _getNormalizedWeightsAndMaxWeightIndex()
        internal
        view
        virtual
        override
        returns (uint256[] memory, uint256)
    {
        return (_getNormalizedWeights(), _maxWeightTokenIndex);
    }

    // Swap Hooks

    function onSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) public virtual override whenNotPaused onlyVault(request.poolId) returns (uint256) {
        bool tokenInIsToken0 = request.tokenIn == _token0;

        uint256 scalingFactorTokenIn = _scalingFactor(tokenInIsToken0);
        uint256 scalingFactorTokenOut = _scalingFactor(!tokenInIsToken0);

        uint256 normalizedWeightIn = tokenInIsToken0 ? _normalizedWeight0 : _normalizedWeight1;
        uint256 normalizedWeightOut = tokenInIsToken0 ? _normalizedWeight1 : _normalizedWeight0;

        // All token amounts are upscaled.
        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);

        // Update price oracle with the pre-swap balances
        _updateOracle(
            request.lastChangeBlock,
            tokenInIsToken0 ? balanceTokenIn : balanceTokenOut,
            tokenInIsToken0 ? balanceTokenOut : balanceTokenIn
        );

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            uint256 amountInMinusSwapFees = _subtractSwapFeeAmount(request.amount);

            // Process the (upscaled!) swap fee.
            uint256 swapFee = request.amount - amountInMinusSwapFees;
            _processSwapFeeAmount(request.tokenIn, _upscale(swapFee, scalingFactorTokenIn));

            request.amount = amountInMinusSwapFees;

            uint256 amountOut = _onSwapGivenIn(
                request,
                balanceTokenIn,
                balanceTokenOut,
                normalizedWeightIn,
                normalizedWeightOut
            );

            // amountOut tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountOut, scalingFactorTokenOut);
        } else {
            request.amount = _upscale(request.amount, scalingFactorTokenOut);

            uint256 amountIn = _onSwapGivenOut(
                request,
                balanceTokenIn,
                balanceTokenOut,
                normalizedWeightIn,
                normalizedWeightOut
            );

            // amountIn tokens are entering the Pool, so we round up.
            amountIn = _downscaleUp(amountIn, scalingFactorTokenIn);

            // Fees are added after scaling happens, to reduce the complexity of the rounding direction analysis.
            uint256 amountInPlusSwapFees = _addSwapFeeAmount(amountIn);

            // Process the (upscaled!) swap fee.
            uint256 swapFee = amountInPlusSwapFees - amountIn;
            _processSwapFeeAmount(request.tokenIn, _upscale(swapFee, scalingFactorTokenIn));

            return amountInPlusSwapFees;
        }
    }

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut,
        uint256 normalizedWeightIn,
        uint256 normalizedWeightOut
    ) private pure returns (uint256) {
        // Swaps are disabled while the contract is paused.
        return
            WeightedMath._calcOutGivenIn(
                currentBalanceTokenIn,
                normalizedWeightIn,
                currentBalanceTokenOut,
                normalizedWeightOut,
                swapRequest.amount
            );
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut,
        uint256 normalizedWeightIn,
        uint256 normalizedWeightOut
    ) private pure returns (uint256) {
        // Swaps are disabled while the contract is paused.
        return
            WeightedMath._calcInGivenOut(
                currentBalanceTokenIn,
                normalizedWeightIn,
                currentBalanceTokenOut,
                normalizedWeightOut,
                swapRequest.amount
            );
    }

    // Join Hook

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        public
        virtual
        override
        onlyVault(poolId)
        whenNotPaused
        returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts)
    {
        uint256[] memory scalingFactors = _scalingFactors();

        uint256 bptAmountOut;
        if (totalSupply() == 0) {
            (bptAmountOut, amountsIn) = _onInitializePool(poolId, sender, recipient, scalingFactors, userData);

            // On initialization, we lock _getMinimumBpt() by minting it for the zero address. This BPT acts as a
            // minimum as it will never be burned, which reduces potential issues with rounding, and also prevents the
            // Pool from ever being fully drained.
            _require(bptAmountOut >= _getMinimumBpt(), Errors.MINIMUM_BPT);
            _mintPoolTokens(address(0), _getMinimumBpt());
            _mintPoolTokens(recipient, bptAmountOut - _getMinimumBpt());

            // amountsIn are amounts entering the Pool, so we round up.
            _downscaleUpArray(amountsIn, scalingFactors);

            // There are no due protocol fee amounts during initialization
            dueProtocolFeeAmounts = new uint256[](2);
        } else {
            _upscaleArray(balances, scalingFactors);

            // Update price oracle with the pre-join balances
            _updateOracle(lastChangeBlock, balances[0], balances[1]);

            (bptAmountOut, amountsIn, dueProtocolFeeAmounts) = _onJoinPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                protocolSwapFeePercentage,
                scalingFactors,
                userData
            );

            // Note we no longer use `balances` after calling `_onJoinPool`, which may mutate it.

            _mintPoolTokens(recipient, bptAmountOut);

            // amountsIn are amounts entering the Pool, so we round up.
            _downscaleUpArray(amountsIn, scalingFactors);
            // dueProtocolFeeAmounts are amounts exiting the Pool, so we round down.
            _downscaleDownArray(dueProtocolFeeAmounts, scalingFactors);
        }

        // Update cached total supply and invariant using the results after the join that will be used for future
        // oracle updates.
        _cacheInvariantAndSupply();
    }

    // Exit Hook

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        public
        virtual
        override
        onlyVault(poolId)
        returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts)
    {
        (amountsOut, dueProtocolFeeAmounts) = super.onExitPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            userData
        );

        // Update cached total supply and invariant using the results after the exit that will be used for future
        // oracle updates, only if the pool was not paused (to minimize code paths taken while paused).
        if (_isNotPaused()) {
            _cacheInvariantAndSupply();
        }
    }

    /**
     * @dev Called whenever the Pool is exited.
     *
     * Returns the amount of BPT to burn, the token amounts for each Pool token that the Pool will grant in return, and
     * the number of tokens to pay in protocol swap fees.
     *
     * Implementations of this function might choose to mutate the `balances` array to save gas (e.g. when
     * performing intermediate calculations, such as subtraction of due protocol fees). This can be done safely.
     *
     * BPT will be burnt from `sender`.
     *
     * The Pool will grant tokens to `recipient`. These amounts are considered upscaled and will be downscaled
     * (rounding down) before being returned to the Vault.
     *
     * Due protocol swap fees will be taken from the Pool's balance in the Vault (see `IBasePool.onExitPool`). These
     * amounts are considered upscaled and will be downscaled (rounding down) before being returned to the Vault.
     */
    function _onExitPool(
        bytes32,
        address,
        address,
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
        // Exits are not completely disabled while the contract is paused: proportional exits (exact BPT in for tokens
        // out) remain functional.

        (uint256[] memory normalizedWeights, uint256 maxWeightTokenIndex) = _getNormalizedWeightsAndMaxWeightIndex();

        if (_isNotPaused()) {
            // Update price oracle with the pre-exit balances
            _updateOracle(lastChangeBlock, balances[0], balances[1]);

            // Due protocol swap fee amounts are computed by measuring the growth of the invariant between the previous
            // join or exit event and now - the invariant's growth is due exclusively to swap fees. This avoids
            // spending gas calculating the fees on each individual swap.
            uint256 invariantBeforeExit = WeightedMath._calculateInvariant(normalizedWeights, balances);
            dueProtocolFeeAmounts = _getDueProtocolFeeAmounts(
                balances,
                normalizedWeights,
                maxWeightTokenIndex,
                getLastInvariant(),
                invariantBeforeExit,
                protocolSwapFeePercentage
            );

            // Update current balances by subtracting the protocol fee amounts
            _mutateAmounts(balances, dueProtocolFeeAmounts, FixedPoint.sub);
        } else {
            // If the contract is paused, swap protocol fee amounts are not charged and the oracle is not updated
            // to avoid extra calculations and reduce the potential for errors.
            dueProtocolFeeAmounts = new uint256[](2);
        }

        (bptAmountIn, amountsOut) = _doExit(balances, normalizedWeights, scalingFactors, userData);

        // Update the invariant with the balances the Pool will have after the exit, in order to compute the
        // protocol swap fees due in future joins and exits.
        _setLastInvariantAfterExit(balances, amountsOut, normalizedWeights);
    }

    // Oracle functions

    /**
     * @dev Updates the Price Oracle based on the Pool's current state (balances, BPT supply and invariant). Must be
     * called on *all* state-changing functions with the balances *before* the state change happens, and with
     * `lastChangeBlock` as the number of the block in which any of the balances last changed.
     */
    function _updateOracle(
        uint256 lastChangeBlock,
        uint256 balanceToken0,
        uint256 balanceToken1
    ) internal {
        bytes32 miscData = _getMiscData();

        if (miscData.decodeBool(_ORACLE_ENABLED_OFFSET) && block.number > lastChangeBlock) {
            int256 logSpotPrice = WeightedOracleMath._calcLogSpotPrice(
                _normalizedWeight0,
                balanceToken0,
                _normalizedWeight1,
                balanceToken1
            );

            int256 logBPTPrice = WeightedOracleMath._calcLogBPTPrice(
                _normalizedWeight0,
                balanceToken0,
                miscData.decodeInt22(_LOG_TOTAL_SUPPLY_OFFSET)
            );

            uint256 oracleCurrentIndex = miscData.decodeUint10(_ORACLE_INDEX_OFFSET);

            uint256 oracleUpdatedIndex = _processPriceData(
                miscData.decodeUint31(_ORACLE_SAMPLE_CREATION_TIMESTAMP_OFFSET),
                oracleCurrentIndex,
                logSpotPrice,
                logBPTPrice,
                miscData.decodeInt22(_LOG_INVARIANT_OFFSET)
            );

            if (oracleCurrentIndex != oracleUpdatedIndex) {
                // solhint-disable not-rely-on-time
                _setMiscData(
                    miscData.insertUint10(oracleUpdatedIndex, _ORACLE_INDEX_OFFSET).insertUint31(
                        block.timestamp,
                        _ORACLE_SAMPLE_CREATION_TIMESTAMP_OFFSET
                    )
                );
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

        if (miscData.decodeBool(_ORACLE_ENABLED_OFFSET)) {
            _setMiscData(
                miscData.insertInt22(LogCompression.toLowResLog(getLastInvariant()), _LOG_INVARIANT_OFFSET).insertInt22(
                    LogCompression.toLowResLog(totalSupply()),
                    _LOG_TOTAL_SUPPLY_OFFSET
                )
            );
        }
    }

    function _getOracleIndex() internal view override returns (uint256) {
        return _getMiscData().decodeUint10(_ORACLE_INDEX_OFFSET);
    }

    // Scaling

    function _scalingFactor(bool token0) internal view returns (uint256) {
        return token0 ? _scalingFactor0 : _scalingFactor1;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return _scalingFactor(token == _token0);
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](2);
        scalingFactors[0] = _scalingFactor0;
        scalingFactors[1] = _scalingFactor1;
        return scalingFactors;
    }

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return 2;
    }

    function _getTotalTokens() internal pure virtual override returns (uint256) {
        return 2;
    }

    function _getNormalizedWeight(IERC20 token) internal view virtual override returns (uint256) {
        return token == _token0 ? _normalizedWeight0 : _normalizedWeight1;
    }
}
