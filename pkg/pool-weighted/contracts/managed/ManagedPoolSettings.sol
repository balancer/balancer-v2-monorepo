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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IControlledManagedPool.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeePercentagesProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/InvariantGrowthProtocolSwapFees.sol";
import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/ProtocolFeeCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/ProtocolAUMFees.sol";

import "../lib/GradualValueChange.sol";
import "../WeightedMath.sol";

import "./vendor/BasePool.sol";

import "./ManagedPoolStorageLib.sol";
import "./ManagedPoolSwapFeesLib.sol";
import "./ManagedPoolTokenLib.sol";

/**
 * @title Managed Pool Settings
 */
abstract contract ManagedPoolSettings is BasePool, ProtocolFeeCache, ReentrancyGuard, IControlledManagedPool {
    // ManagedPool weights and swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WeightedPoolUserData for bytes;

    // State variables

    uint256 private constant _MIN_TOKENS = 2;
    // The upper bound is WeightedMath.MAX_WEIGHTED_TOKENS, but this is constrained by other factors, such as Pool
    // creation gas consumption.
    uint256 private constant _MAX_TOKENS = 38;

    uint256 private constant _MAX_MANAGEMENT_SWAP_FEE_PERCENTAGE = 1e18; // 100%

    uint256 private constant _MAX_MANAGEMENT_AUM_FEE_PERCENTAGE = 1e17; // 10%

    // Stores commonly used Pool state.
    // This slot is preferred for gas-sensitive operations as it is read in all joins, swaps and exits,
    // and therefore warm.
    // See `ManagedPoolStorageLib.sol` for data layout.
    bytes32 private _poolState;

    // Store scaling factor and start/end denormalized weights for each token.
    // See `ManagedPoolTokenLib.sol` for data layout.
    mapping(IERC20 => bytes32) private _tokenState;

    // If mustAllowlistLPs is enabled, this is the list of addresses allowed to join the pool
    mapping(address => bool) private _allowedAddresses;

    // We need to work with normalized weights (i.e. they should add up to 100%), but storing normalized weights
    // would require updating all weights whenever one of them changes, for example in an add or remove token
    // operation. Instead, we keep track of the sum of all denormalized weights, and dynamically normalize them
    // for I/O by multiplying or dividing by the `_denormWeightSum`.
    //
    // In this contract, "weights" mean normalized weights, and "denormWeights" refer to how they are stored internally.
    uint256 private _denormWeightSum;

    // Percentage of the pool's TVL to pay as management AUM fees over the course of a year.
    uint256 private _managementAumFeePercentage;

    // Timestamp of the most recent collection of management AUM fees.
    // Note that this is only initialized the first time fees are collected.
    uint256 internal _lastAumFeeCollectionTimestamp;

    // Event declarations

    event GradualWeightUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256[] startWeights,
        uint256[] endWeights
    );
    event SwapEnabledSet(bool swapEnabled);
    event MustAllowlistLPsSet(bool mustAllowlistLPs);
    event ManagementAumFeePercentageChanged(uint256 managementAumFeePercentage);
    event ManagementAumFeeCollected(uint256 bptAmount);
    event AllowlistAddressAdded(address indexed member);
    event AllowlistAddressRemoved(address indexed member);
    event TokenAdded(IERC20 indexed token, uint256 normalizedWeight);
    event TokenRemoved(IERC20 indexed token);

    struct NewPoolParams {
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] normalizedWeights;
        address[] assetManagers;
        uint256 swapFeePercentage;
        bool swapEnabledOnStart;
        bool mustAllowlistLPs;
        uint256 managementAumFeePercentage;
    }

    constructor(
        NewPoolParams memory params,
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        address owner,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
            params.name,
            params.symbol,
            params.tokens,
            params.assetManagers,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
        ProtocolFeeCache(protocolFeeProvider)
    {
        uint256 totalTokens = params.tokens.length;
        _require(totalTokens >= _MIN_TOKENS, Errors.MIN_TOKENS);
        _require(totalTokens <= _MAX_TOKENS, Errors.MAX_TOKENS);

        InputHelpers.ensureInputLengthMatch(totalTokens, params.normalizedWeights.length, params.assetManagers.length);

        // Validate and set initial fees
        _setManagementAumFeePercentage(params.managementAumFeePercentage);

        // Write the scaling factors for each token into their token state.
        // We do this before setting the weights in `_startGradualWeightChange` so we start from a empty token state.
        for (uint256 i = 0; i < totalTokens; i++) {
            IERC20 token = params.tokens[i];
            _tokenState[token] = ManagedPoolTokenLib.setTokenScalingFactor(bytes32(0), token);
        }

        // This bytes32 holds a lot of the core Pool state which is read on most interactions, by keeping it in a single
        // word we can save gas from unnecessary storage reads. It includes items like:
        // - Swap fees
        // - Weight change progress
        // - Various feature flags
        bytes32 poolState;

        poolState = _startGradualWeightChange(
            poolState,
            block.timestamp,
            block.timestamp,
            params.normalizedWeights,
            params.normalizedWeights,
            params.tokens
        );

        // Weights are normalized, so initialize the denormalized weight sum to ONE. The denormalized weight sum will
        // only deviate from ONE when tokens are added or removed, and are renormalized on the next weight change.
        _denormWeightSum = FixedPoint.ONE;

        poolState = ManagedPoolSwapFeesLib.startGradualSwapFeeChange(
            poolState,
            block.timestamp,
            block.timestamp,
            params.swapFeePercentage,
            params.swapFeePercentage
        );

        // We write the pool state here, as both `_setSwapEnabled` and `_setMustAllowlistLPs` read it from storage.
        _poolState = poolState;

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction).
        _setSwapEnabled(params.swapEnabledOnStart);

        // If true, only addresses on the manager-controlled allowlist may join the pool.
        _setMustAllowlistLPs(params.mustAllowlistLPs);
    }

    function _getPoolState() internal view returns (bytes32) {
        return _poolState;
    }

    // Swap fees

    /**
     * @notice Returns the current value of the swap fee percentage.
     * @dev Computes the current swap fee percentage, which can change every block if a gradual swap fee
     * update is in progress.
     */
    function getSwapFeePercentage() public view override returns (uint256) {
        return ManagedPoolStorageLib.getSwapFeePercentage(_poolState);
    }

    /**
     * @notice Returns the current gradual swap fee update parameters.
     * @dev The current swap fee can be retrieved via `getSwapFeePercentage()`.
     * @return startTime - The timestamp when the swap fee update will begin.
     * @return endTime - The timestamp when the swap fee update will end.
     * @return startSwapFeePercentage - The starting swap fee percentage (could be different from the current value).
     * @return endSwapFeePercentage - The final swap fee percentage, when the current timestamp >= endTime.
     */
    function getGradualSwapFeeUpdateParams()
        external
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        )
    {
        return ManagedPoolStorageLib.getSwapFeeFields(_poolState);
    }

    /**
     * @notice Set the swap fee percentage.
     * @dev This is a permissioned function, and disabled if the pool is paused. The swap fee must be within the
     * bounds set by MIN_SWAP_FEE_PERCENTAGE/MAX_SWAP_FEE_PERCENTAGE. Emits the SwapFeePercentageChanged event.
     */
    function setSwapFeePercentage(uint256 swapFeePercentage) external override authenticate whenNotPaused {
        // Do not allow setting if there is an ongoing fee change
        uint256 currentTime = block.timestamp;
        bytes32 poolState = _poolState;
        (uint256 startTime, uint256 endTime, , ) = ManagedPoolStorageLib.getSwapFeeFields(poolState);

        if (currentTime < endTime) {
            _revert(
                currentTime < startTime ? Errors.SET_SWAP_FEE_PENDING_FEE_CHANGE : Errors.SET_SWAP_FEE_DURING_FEE_CHANGE
            );
        }

        _poolState = ManagedPoolSwapFeesLib.setSwapFeePercentage(poolState, swapFeePercentage);
    }

    /**
     * @notice Schedule a gradual swap fee update.
     * @dev The swap fee will change from the given starting value (which may or may not be the current
     * value) to the given ending fee percentage, over startTime to endTime. Calling this with a starting
     * value avoids requiring an explicit external `setSwapFeePercentage` call.
     *
     * Note that calling this with a starting swap fee different from the current value will immediately change the
     * current swap fee to `startSwapFeePercentage` (including emitting the SwapFeePercentageChanged event),
     * before commencing the gradual change at `startTime`. Emits the GradualSwapFeeUpdateScheduled event.
     * This is a permissioned function.
     *
     * @param startTime - The timestamp when the swap fee change will begin.
     * @param endTime - The timestamp when the swap fee change will end (must be >= startTime).
     * @param startSwapFeePercentage - The starting value for the swap fee change.
     * @param endSwapFeePercentage - The ending value for the swap fee change. If the current timestamp >= endTime,
     * `getSwapFeePercentage()` will return this value.
     */
    function updateSwapFeeGradually(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) external authenticate whenNotPaused nonReentrant {
        _poolState = ManagedPoolSwapFeesLib.startGradualSwapFeeChange(
            _poolState,
            startTime,
            endTime,
            startSwapFeePercentage,
            endSwapFeePercentage
        );
    }

    // Token weights

    /**
     * @dev Returns the normalized weight of `token`. Weights are fixed point numbers that sum to FixedPoint.ONE.
     */
    function _getNormalizedWeight(IERC20 token, uint256 weightChangeProgress) internal view returns (uint256) {
        return ManagedPoolTokenLib.getTokenWeight(_tokenState[token], weightChangeProgress, _denormWeightSum);
    }

    /**
     * @dev Returns all normalized weights, in the same order as the Pool's tokens.
     */
    function _getNormalizedWeights(IERC20[] memory tokens) internal view returns (uint256[] memory normalizedWeights) {
        uint256 weightChangeProgress = ManagedPoolStorageLib.getGradualWeightChangeProgress(_poolState);
        uint256 denormWeightSum = _denormWeightSum;

        uint256 numTokens = tokens.length;
        normalizedWeights = new uint256[](numTokens);
        for (uint256 i = 0; i < numTokens; i++) {
            normalizedWeights[i] = ManagedPoolTokenLib.getTokenWeight(
                _tokenState[tokens[i]],
                weightChangeProgress,
                denormWeightSum
            );
        }
    }

    /**
     * @notice Returns all normalized weights, in the same order as the Pool's tokens.
     */
    function getNormalizedWeights() external view returns (uint256[] memory) {
        (IERC20[] memory tokens, ) = _getPoolTokens();
        return _getNormalizedWeights(tokens);
    }

    /**
     * @dev Returns the current sum of denormalized weights.
     * @dev The normalization factor, which is used to efficiently scale weights when adding and removing.
     * tokens. This value is an internal implementation detail and typically useless from the outside.
     */
    function getDenormalizedWeightSum() public view returns (uint256) {
        return _denormWeightSum;
    }

    /**
     * @notice Returns the current gradual weight change update parameters.
     * @dev The current weights can be retrieved via `getNormalizedWeights()`.
     * @return startTime - The timestamp when the weight update will begin.
     * @return endTime - The timestamp when the weight update will end.
     * @return startWeights - The starting weights, when the weight change was initiated.
     * @return endWeights - The final weights, when the current timestamp >= endTime.
     */
    function getGradualWeightUpdateParams()
        external
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory startWeights,
            uint256[] memory endWeights
        )
    {
        (startTime, endTime) = ManagedPoolStorageLib.getWeightChangeFields(_poolState);

        (IERC20[] memory tokens, ) = _getPoolTokens();
        uint256 totalTokens = tokens.length;

        startWeights = new uint256[](totalTokens);
        endWeights = new uint256[](totalTokens);

        uint256 denormWeightSum = _denormWeightSum;
        for (uint256 i = 0; i < totalTokens; i++) {
            (startWeights[i], endWeights[i]) = ManagedPoolTokenLib.getTokenStartAndEndWeights(
                _tokenState[tokens[i]],
                denormWeightSum
            );
        }
    }

    function _ensureNoWeightChange() private view {
        uint256 currentTime = block.timestamp;
        (uint256 startTime, uint256 endTime) = ManagedPoolStorageLib.getWeightChangeFields(_poolState);

        if (currentTime < endTime) {
            _revert(
                currentTime < startTime
                    ? Errors.CHANGE_TOKENS_PENDING_WEIGHT_CHANGE
                    : Errors.CHANGE_TOKENS_DURING_WEIGHT_CHANGE
            );
        }
    }

    /**
     * @notice Schedule a gradual weight change.
     * @dev The weights will change from their current values to the given endWeights, over startTime to endTime.
     * This is a permissioned function.
     *
     * Since, unlike with swap fee updates, we generally do not want to allow instantaneous weight changes,
     * the weights always start from their current values. This also guarantees a smooth transition when
     * updateWeightsGradually is called during an ongoing weight change.
     * @param startTime - The timestamp when the weight change will begin.
     * @param endTime - The timestamp when the weight change will end (can be >= startTime).
     * @param endWeights - The target weights. If the current timestamp >= endTime, `getNormalizedWeights()`
     * will return these values.
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external override authenticate whenNotPaused nonReentrant {
        (IERC20[] memory tokens, ) = _getPoolTokens();

        InputHelpers.ensureInputLengthMatch(tokens.length, endWeights.length);

        startTime = GradualValueChange.resolveStartTime(startTime, endTime);

        _poolState = _startGradualWeightChange(
            _poolState,
            startTime,
            endTime,
            _getNormalizedWeights(tokens),
            endWeights,
            tokens
        );

        // `_startGradualWeightChange` renormalizes the weights, so we reset `_denormWeightSum` to ONE.
        _denormWeightSum = FixedPoint.ONE;
    }

    /**
     * @dev When calling updateWeightsGradually again during an update, reset the start weights to the current weights,
     * if necessary.
     */
    function _startGradualWeightChange(
        bytes32 poolState,
        uint256 startTime,
        uint256 endTime,
        uint256[] memory startWeights,
        uint256[] memory endWeights,
        IERC20[] memory tokens
    ) internal returns (bytes32) {
        uint256 normalizedSum;

        // As we're writing all the weights to storage again we have the opportunity to normalize them by an arbitrary
        // value. We then can take this opportunity to reset the `_denormWeightSum` to `FixedPoint.ONE` by passing it
        // into `ManagedPoolTokenLib.setTokenWeight`.
        _denormWeightSum = FixedPoint.ONE;
        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);
            normalizedSum = normalizedSum.add(endWeight);

            IERC20 token = tokens[i];
            _tokenState[token] = ManagedPoolTokenLib.setTokenWeight(
                _tokenState[token],
                startWeights[i],
                endWeight,
                FixedPoint.ONE
            );
        }

        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);

        return ManagedPoolStorageLib.setWeightChangeData(poolState, startTime, endTime);
    }

    // Invariant

    /**
     * @dev Returns the current value of the invariant.
     */
    function getInvariant() external view returns (uint256) {
        (IERC20[] memory tokens, uint256[] memory balances) = _getPoolTokens();

        // Since the Pool hooks always work with upscaled balances, we manually
        // upscale here for consistency
        _upscaleArray(balances, _scalingFactors(tokens));

        uint256[] memory normalizedWeights = _getNormalizedWeights(tokens);
        return WeightedMath._calculateInvariant(normalizedWeights, balances);
    }

    // Swap Enabled

    /**
     * @notice Returns whether swaps are enabled.
     */
    function getSwapEnabled() external view returns (bool) {
        return ManagedPoolStorageLib.getSwapsEnabled(_poolState);
    }

    /**
     * @notice Enable or disable trading.
     * @dev Emits the SwapEnabledSet event. This is a permissioned function.
     * @param swapEnabled - The new value of the swap enabled flag.
     */
    function setSwapEnabled(bool swapEnabled) external override authenticate whenNotPaused {
        _setSwapEnabled(swapEnabled);
    }

    function _setSwapEnabled(bool swapEnabled) private {
        _poolState = ManagedPoolStorageLib.setSwapsEnabled(_poolState, swapEnabled);

        emit SwapEnabledSet(swapEnabled);
    }

    // LP Allowlist

    /**
     * @notice Returns whether the allowlist for LPs is enabled.
     */
    function getMustAllowlistLPs() public view returns (bool) {
        return ManagedPoolStorageLib.getLPAllowlistEnabled(_poolState);
    }

    /**
     * @notice Check an LP address against the allowlist.
     * @dev If the allowlist is not enabled, this returns true for every address.
     * @param member - The address to check against the allowlist.
     * @return true if the given address is allowed to join the pool.
     */
    function isAllowedAddress(address member) public view returns (bool) {
        return !getMustAllowlistLPs() || _allowedAddresses[member];
    }

    /**
     * @notice Adds an address to the LP allowlist.
     * @dev Will fail if the LP allowlist is not enabled, or the address is already allowlisted.
     * Emits the AllowlistAddressAdded event. This is a permissioned function.
     * @param member - The address to be added to the allowlist.
     */
    function addAllowedAddress(address member) external override authenticate whenNotPaused {
        _require(getMustAllowlistLPs(), Errors.FEATURE_DISABLED);
        _require(!_allowedAddresses[member], Errors.ADDRESS_ALREADY_ALLOWLISTED);

        _allowedAddresses[member] = true;
        emit AllowlistAddressAdded(member);
    }

    /**
     * @notice Removes an address from the LP allowlist.
     * @dev Will fail if the LP allowlist is not enabled, or the address was not previously allowlisted.
     * Emits the AllowlistAddressRemoved event. Do not allow removing addresses while the allowlist
     * is disabled. This is a permissioned function.
     * @param member - The address to be removed from the allowlist.
     */
    function removeAllowedAddress(address member) external override authenticate whenNotPaused {
        _require(getMustAllowlistLPs(), Errors.FEATURE_DISABLED);
        _require(_allowedAddresses[member], Errors.ADDRESS_NOT_ALLOWLISTED);

        delete _allowedAddresses[member];
        emit AllowlistAddressRemoved(member);
    }

    /**
     * @notice Enable or disable the LP allowlist.
     * @dev Note that any addresses added to the allowlist will be retained if the allowlist is toggled off and
     * back on again, because adding or removing addresses is not allowed while the allowlist is disabled.
     * Emits the MustAllowlistLPsSet event. This is a permissioned function.
     * @param mustAllowlistLPs - The new value of the mustAllowlistLPs flag.
     */
    function setMustAllowlistLPs(bool mustAllowlistLPs) external override authenticate whenNotPaused {
        _setMustAllowlistLPs(mustAllowlistLPs);
    }

    function _setMustAllowlistLPs(bool mustAllowlistLPs) private {
        _poolState = ManagedPoolStorageLib.setLPAllowlistEnabled(_poolState, mustAllowlistLPs);

        emit MustAllowlistLPsSet(mustAllowlistLPs);
    }

    // AUM management fees

    /**
     * @notice Returns the management AUM fee percentage as an 18-decimal fixed point number.
     */
    function getManagementAumFeePercentage() public view returns (uint256) {
        return _managementAumFeePercentage;
    }

    /**
     * @notice Returns the timestamp of the last collection of AUM fees.
     */
    function getLastAumFeeCollectionTimestamp() external view returns (uint256) {
        return _lastAumFeeCollectionTimestamp;
    }

    /**
     * @notice Setter for the yearly percentage AUM management fee, which is payable to the pool manager.
     * @dev Attempting to collect AUM fees in excess of the maximum permitted percentage will revert.
     * To avoid retroactive fee increases, we force collection at the current fee percentage before processing
     * the update. Emits the ManagementAumFeePercentageChanged event. This is a permissioned function.
     * @param managementAumFeePercentage - The new management AUM fee percentage.
     * @return amount - The amount of BPT minted to the manager before the update, if any.
     */
    function setManagementAumFeePercentage(uint256 managementAumFeePercentage)
        external
        override
        authenticate
        whenNotPaused
        returns (uint256 amount)
    {
        // We want to prevent the pool manager from retroactively increasing the amount of AUM fees payable.
        // To prevent this, we perform a collection before updating the fee percentage.
        // This is only necessary if the pool has been initialized (which is indicated by a nonzero total supply).
        uint256 supplyBeforeFeeCollection = totalSupply();
        if (supplyBeforeFeeCollection > 0) {
            (, amount) = _collectAumManagementFees(supplyBeforeFeeCollection);
            _lastAumFeeCollectionTimestamp = block.timestamp;
        }

        _setManagementAumFeePercentage(managementAumFeePercentage);
    }

    function _setManagementAumFeePercentage(uint256 managementAumFeePercentage) private {
        _require(
            managementAumFeePercentage <= _MAX_MANAGEMENT_AUM_FEE_PERCENTAGE,
            Errors.MAX_MANAGEMENT_AUM_FEE_PERCENTAGE
        );

        _managementAumFeePercentage = managementAumFeePercentage;
        emit ManagementAumFeePercentageChanged(managementAumFeePercentage);
    }

    /**
     * @notice Collect any accrued AUM fees and send them to the pool manager.
     * @dev This can be called by anyone to collect accrued AUM fees - and will be called automatically on
     * joins and exits.
     * @return The amount of BPT minted to the manager.
     */
    function collectAumManagementFees() external override whenNotPaused returns (uint256) {
        // It only makes sense to collect AUM fees after the pool is initialized (as before then the AUM is zero).
        // We can query if the pool is initialized by checking for a nonzero total supply.
        // Reverting here prevents zero value AUM fee collections causing bogus events.
        uint256 supplyBeforeFeeCollection = totalSupply();
        if (supplyBeforeFeeCollection == 0) _revert(Errors.UNINITIALIZED);

        (, uint256 managerAUMFees) = _collectAumManagementFees(supplyBeforeFeeCollection);
        return managerAUMFees;
    }

    /**
     * @dev Calculates the AUM fees accrued since the last collection and pays it to the pool manager.
     * This function is called automatically on joins and exits.
     */
    function _collectAumManagementFees(uint256 totalSupply) internal returns (uint256, uint256) {
        uint256 bptAmount = ProtocolAUMFees.getAumFeesBptAmount(
            totalSupply,
            block.timestamp,
            _lastAumFeeCollectionTimestamp,
            getManagementAumFeePercentage()
        );

        // Early return if either:
        // - AUM fee is disabled.
        // - no time has passed since the last collection.
        if (bptAmount == 0) {
            return (0, 0);
        }

        // As we update `_lastAumFeeCollectionTimestamp` when updating `_managementAumFeePercentage`, we only need to
        // update `_lastAumFeeCollectionTimestamp` when non-zero AUM fees are paid. This avoids an SSTORE on zero-length
        // collections.
        _lastAumFeeCollectionTimestamp = block.timestamp;

        // Split AUM fees between protocol and Pool manager.
        uint256 protocolBptAmount = bptAmount.mulUp(getProtocolFeePercentageCache(ProtocolFeeType.AUM));
        uint256 managerBPTAmount = bptAmount.sub(protocolBptAmount);

        _payProtocolFees(protocolBptAmount);

        emit ManagementAumFeeCollected(managerBPTAmount);

        _mintPoolTokens(getOwner(), managerBPTAmount);

        return (protocolBptAmount, managerBPTAmount);
    }

    // Add/Remove tokens

    /**
     * @notice Adds a token to the Pool's list of tradeable tokens. This is a permissioned function.
     *
     * @dev By adding a token to the Pool's composition, the weights of all other tokens will be decreased. The new
     * token will have no balance - it is up to the controller to provide some immediately after calling this function.
     * Note however that regular join functions will not work while the new token has no balance: the only way to
     * deposit an initial amount is by using an Asset Manager.
     *
     * Token addition is forbidden during a weight change, or if one is scheduled to happen in the future.
     *
     * The caller may additionally pass a non-zero `mintAmount` to have some BPT be minted for them, which might be
     * useful in some scenarios to account for the fact that the Pool will have more tokens.
     *
     * Emits the TokenAdded event.
     *
     * @param token - The ERC20 token to be added to the Pool.
     * @param assetManager - The Asset Manager for the token.
     * @param normalizedWeight - The normalized weight of `token` relative to the other tokens in the Pool.
     * @param mintAmount - The amount of BPT to be minted as a result of adding `token` to the Pool.
     * @param recipient - The address to receive the BPT minted by the Pool.
     */
    function addToken(
        IERC20 token,
        address assetManager,
        uint256 normalizedWeight,
        uint256 mintAmount,
        address recipient
    ) external authenticate whenNotPaused {
        uint256 supply = totalSupply();
        _require(supply > 0, Errors.UNINITIALIZED);

        // To reduce the complexity of weight interactions, tokens cannot be added during or before a weight change.
        // Checking for the validity of the new weight would otherwise be much more complicated.
        _ensureNoWeightChange();

        // Total supply is potentially changing so we collect AUM fees.
        _collectAumManagementFees(supply);

        // We need to check that both the new weight is valid, and that it won't make any of the existing weights
        // invalid.
        uint256 weightSumAfterAdd = _validateNewWeight(normalizedWeight);

        // Adding the new token to the pool decreases all other normalized weights to 'make room' for the new one. This
        // is achieved efficiently by simply updating the sum of the denormalized weights.
        _denormWeightSum = weightSumAfterAdd;

        // Finally, we store the new token's weight and scaling factor.
        _tokenState[token] = ManagedPoolTokenLib.initializeTokenState(token, normalizedWeight, weightSumAfterAdd);

        if (mintAmount > 0) {
            _mintPoolTokens(recipient, mintAmount);
        }

        // Once we've updated the internal state, we register the token in the Vault. This makes the Pool enter an
        // invalid state, since one of its tokens has a balance of zero (making the invariant also zero). The Asset
        // Manager must be used to deposit some initial balance and restore regular operation.
        //
        // We don't need to check that the new token is not already in the Pool, as the Vault will simply revert if we
        // try to register it again.
        PoolRegistrationLib.registerToken(getVault(), getPoolId(), token, assetManager);

        emit TokenAdded(token, normalizedWeight);
    }

    function _validateNewWeight(uint256 normalizedWeight) private view returns (uint256) {
        (IERC20[] memory tokens, ) = _getPoolTokens();

        // Sanity check that the new token will make up less than 100% of the Pool.
        _require(normalizedWeight < FixedPoint.ONE, Errors.MAX_WEIGHT);
        // Make sure the new token is above the minimum weight.
        _require(normalizedWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

        uint256 numTokens = tokens.length;
        _require(numTokens + 1 <= _MAX_TOKENS, Errors.MAX_TOKENS);

        // The growth in the total weight of the pool can be calculated by:
        //
        // weightSumRatio = totalWeight / (totalWeight - newTokenWeight)
        //
        // As we're working with normalized weights, `totalWeight` is equal to 1.
        //
        // We can then calculate the new denormalized weight sum by applying this ratio to the old sum.
        uint256 weightSumAfterAdd = _denormWeightSum.divDown(FixedPoint.ONE - normalizedWeight);

        // We want to check if adding this new token results in any tokens falling below the minimum weight limit.
        // Adding a new token could cause one of the other tokens to be pushed below the minimum weight.
        // If any would fail this check, it would be the token with the lowest weight, so we search through all
        // tokens to find the minimum weight and normalize it with the new value for `denormWeightSum`.
        uint256 minimumNormalizedWeight = ManagedPoolTokenLib.getMinimumTokenEndWeight(
            _tokenState,
            tokens,
            weightSumAfterAdd
        );
        // Now we know the minimum weight we can check that it doesn't get pushed below the minimum.
        _require(minimumNormalizedWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

        return weightSumAfterAdd;
    }

    /**
     * @notice Removes a token from the Pool's list of tradeable tokens.
     * @dev Tokens can only be removed if the Pool has more than 2 tokens, as it can never have fewer than 2. Token
     * removal is also forbidden during a weight change, or if one is scheduled to happen in the future.
     *
     * Emits the TokenRemoved event. This is a permissioned function.
     *
     * The caller may additionally pass a non-zero `burnAmount` to burn some of their BPT, which might be useful
     * in some scenarios to account for the fact that the Pool now has fewer tokens. This is a permissioned function.
     * @param token - The ERC20 token to be removed from the Pool.
     * @param burnAmount - The amount of BPT to be burned after removing `token` from the Pool.
     * @param sender - The address to burn BPT from.
     */
    function removeToken(
        IERC20 token,
        uint256 burnAmount,
        address sender
    ) external authenticate nonReentrant whenNotPaused {
        uint256 supply = totalSupply();
        _require(supply > 0, Errors.UNINITIALIZED);

        // To reduce the complexity of weight interactions, tokens cannot be removed during or before a weight change.
        // This is for symmetry with addToken.
        _ensureNoWeightChange();

        // Total supply is potentially changing so we collect AUM fees.
        _collectAumManagementFees(supply);

        // Before this function is called, the caller must have withdrawn all balance for `token` from the Pool. This
        // means that the Pool is in an invalid state, since among other things the invariant is zero. Because we're not
        // in a valid state and all value-changing operations will revert, we are free to modify the Pool state (e.g.
        // alter weights).
        // We don't need to test the zero balance since the Vault will simply revert on deregistration if this is not
        // the case.

        // Removing a token will cause for the weights of all other tokens to increase. This is fine, as there is no
        // maximum weight. We also don't need to check that the new token exists in the Pool, as the Vault will simply
        // revert if we try to deregister a token that is not registered.
        // We do, however, want to check that the Pool will end up with at least two tokens. This simplifies some
        // assumptions made elsewhere (e.g. the denormalized weight sum will always be non-zero), and doesn't greatly
        // restrict the controller.

        (IERC20[] memory tokens, ) = _getPoolTokens();
        _require(tokens.length > 2, Errors.MIN_TOKENS);

        uint256 tokenNormalizedWeight = _getNormalizedWeight(
            token,
            ManagedPoolStorageLib.getGradualWeightChangeProgress(_poolState)
        );

        // State cleanup is simply done by removing the portion of the denormalized weight that corresponds to the token
        // being removed, and then deleting all token-specific state.
        _denormWeightSum -= tokenNormalizedWeight.mulDown(_denormWeightSum);
        delete _tokenState[token];

        if (burnAmount > 0) {
            // We disallow burning from the zero address, as that would allow potentially returning the Pool to the
            // uninitialized state.
            _require(sender != address(0), Errors.BURN_FROM_ZERO);
            _burnPoolTokens(sender, burnAmount);
        }

        // We can then deregister the token in the Vault. This will revert unless the token is registered and the Pool
        // has a zero balance of it.
        PoolRegistrationLib.deregisterToken(getVault(), getPoolId(), token);

        // The Pool is now again in a valid state: by the time the zero valued token is deregistered, all internal Pool
        // state is updated.

        emit TokenRemoved(token);
    }

    // Scaling Factors

    function _scalingFactor(IERC20 token) internal view returns (uint256) {
        return ManagedPoolTokenLib.getTokenScalingFactor(_tokenState[token]);
    }

    function getScalingFactors() external view override returns (uint256[] memory) {
        (IERC20[] memory tokens, ) = _getPoolTokens();
        return _scalingFactors(tokens);
    }

    function _scalingFactors(IERC20[] memory tokens) internal view returns (uint256[] memory scalingFactors) {
        uint256 numTokens = tokens.length;
        scalingFactors = new uint256[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = ManagedPoolTokenLib.getTokenScalingFactor(_tokenState[tokens[i]]);
        }
    }

    // Protocol Fee Cache

    /**
     * @dev Pays any due protocol and manager fees before updating the cached protocol fee percentages.
     */
    function _beforeProtocolFeeCacheUpdate() internal override {
        // We pay any due protocol or manager fees *before* updating the cache. This ensures that the new
        // percentages only affect future operation of the Pool, and not past fees.

        // Given that this operation is state-changing and relatively complex, we only allow it as long as the Pool is
        // not paused.
        _ensureNotPaused();

        _collectAumManagementFees(totalSupply());
    }

    // Recovery Mode

    /**
     * @notice Returns whether the pool is in Recovery Mode.
     */
    function inRecoveryMode() public view override returns (bool) {
        return ManagedPoolStorageLib.getRecoveryModeEnabled(_poolState);
    }

    /**
     * @dev Sets the recoveryMode state, and emits the corresponding event.
     */
    function _setRecoveryMode(bool enabled) internal override {
        _poolState = ManagedPoolStorageLib.setRecoveryModeEnabled(_poolState, enabled);

        emit RecoveryModeStateChanged(enabled);

        // Some pools need to update their state when leaving recovery mode to ensure proper functioning of the Pool.
        // We do not perform any state updates when entering recovery mode as this may jeopardize the ability to enable
        // Recovery mode.
        if (!enabled) {
            // Recovery mode exits bypass the AUM fee calculation which means that in the case where the Pool is paused
            // and in Recovery mode for a period of time and then later returns to normal operation then AUM fees will
            // be charged to the remaining LPs for the full period. We then update the collection timestamp so that no
            // AUM fees are accrued over this period.
            _lastAumFeeCollectionTimestamp = block.timestamp;
        }
    }

    // Misc

    /**
     * @dev Enumerates all ownerOnly functions in Managed Pool.
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(ManagedPoolSettings.updateWeightsGradually.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.updateSwapFeeGradually.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setSwapEnabled.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setSwapFeePercentage.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.addAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.removeAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setMustAllowlistLPs.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.addToken.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.removeToken.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setManagementAumFeePercentage.selector));
    }

    /**
     * @notice Returns the tokens in the Pool and their current balances.
     * @dev This function is expected to be overridden in cases where some processing needs to happen on these arrays.
     * A common example of this is in composable pools as we may need to drop the BPT token and its balance.
     */
    function _getPoolTokens() internal view virtual returns (IERC20[] memory tokens, uint256[] memory balances) {
        (tokens, balances, ) = getVault().getPoolTokens(getPoolId());
    }
}
