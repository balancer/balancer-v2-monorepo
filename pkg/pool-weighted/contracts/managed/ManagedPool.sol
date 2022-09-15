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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableMap.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/InvariantGrowthProtocolSwapFees.sol";
import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/ProtocolFeeCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/ProtocolAUMFees.sol";

import "../lib/GradualValueChange.sol";
import "../lib/WeightCompression.sol";

import "./vendor/BaseWeightedPool.sol";

import "./ManagedPoolStorageLib.sol";
import "./ManagedPoolSwapFeesLib.sol";
import "./ManagedPoolTokenLib.sol";

/**
 * @dev Weighted Pool with mutable tokens and weights, designed to be used in conjunction with a pool controller
 * contract (as the owner, containing any specific business logic). Since the pool itself permits "dangerous"
 * operations, it should never be deployed with an EOA as the owner.
 *
 * Pool controllers can add functionality: for example, allow the effective "owner" to be transferred to another
 * address. (The actual pool owner is still immutable, set to the pool controller contract.) Another pool owner
 * might allow fine-grained permissioning of protected operations: perhaps a multisig can add/remove tokens, but
 * a third-party EOA is allowed to set the swap fees.
 *
 * Pool controllers might also impose limits on functionality so that operations that might endanger LPs can be
 * performed more safely. For instance, the pool by itself places no restrictions on the duration of a gradual
 * weight change, but a pool controller might restrict this in various ways, from a simple minimum duration,
 * to a more complex rate limit.
 *
 * Pool controllers can also serve as intermediate contracts to hold tokens, deploy timelocks, consult with other
 * protocols or on-chain oracles, or bundle several operations into one transaction that re-entrancy protection
 * would prevent initiating from the pool contract.
 *
 * Managed Pools and their controllers are designed to support many asset management use cases, including: large
 * token counts, rebalancing through token changes, gradual weight or fee updates, fine-grained control of
 * protocol and management fees, allowlisting of LPs, and more.
 */
contract ManagedPool is BaseWeightedPool, ProtocolFeeCache, ReentrancyGuard, IControlledManagedPool {
    // ManagedPool weights and swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;
    using WeightedPoolUserData for bytes;

    // State variables

    uint256 private constant _MIN_TOKENS = 2;
    // The upper bound is WeightedMath.MAX_WEIGHTED_TOKENS, but this is constrained by other factors, such as Pool
    // creation gas consumption.
    uint256 private constant _MAX_MANAGED_TOKENS = 38;

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

    // Percentage of swap fees that are allocated to the Pool owner, after protocol fees
    uint256 private _managementSwapFeePercentage;

    // Store the token count locally (can change if tokens are added or removed)
    uint256 private _totalTokensCache;

    // Percentage of the pool's TVL to pay as management AUM fees over the course of a year.
    uint256 private _managementAumFeePercentage;

    // Timestamp of the most recent collection of management AUM fees.
    // Note that this is only initialized the first time fees are collected.
    uint256 private _lastAumFeeCollectionTimestamp;

    // Event declarations

    event GradualWeightUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256[] startWeights,
        uint256[] endWeights
    );
    event SwapEnabledSet(bool swapEnabled);
    event MustAllowlistLPsSet(bool mustAllowlistLPs);
    event ManagementSwapFeePercentageChanged(uint256 managementSwapFeePercentage);
    event ManagementAumFeePercentageChanged(uint256 managementAumFeePercentage);
    event ManagementAumFeeCollected(uint256 bptAmount);
    event AllowlistAddressAdded(address indexed member);
    event AllowlistAddressRemoved(address indexed member);
    event TokenAdded(IERC20 indexed token, uint256 normalizedWeight);
    event TokenRemoved(IERC20 indexed token, uint256 normalizedWeight, uint256 tokenAmountOut);

    struct NewPoolParams {
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] normalizedWeights;
        address[] assetManagers;
        uint256 swapFeePercentage;
        bool swapEnabledOnStart;
        bool mustAllowlistLPs;
        uint256 managementSwapFeePercentage;
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
        BaseWeightedPool(
            vault,
            params.name,
            params.symbol,
            params.tokens,
            params.assetManagers,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
            true
        )
        ProtocolFeeCache(protocolFeeProvider)
    {
        uint256 totalTokens = params.tokens.length;
        _require(totalTokens >= _MIN_TOKENS, Errors.MIN_TOKENS);
        _require(totalTokens <= _getMaxTokens(), Errors.MAX_TOKENS);

        InputHelpers.ensureInputLengthMatch(totalTokens, params.normalizedWeights.length, params.assetManagers.length);

        _totalTokensCache = totalTokens;

        // Validate and set initial fees
        _setManagementSwapFeePercentage(params.managementSwapFeePercentage);

        _setManagementAumFeePercentage(params.managementAumFeePercentage);

        // Write the scaling factors for each token into their token state.
        // We do this before setting the weights in `_startGradualWeightChange` so we start from a empty token state.
        for (uint256 i = 0; i < totalTokens; i++) {
            IERC20 token = params.tokens[i];
            _tokenState[token] = ManagedPoolTokenLib.setTokenScalingFactor(bytes32(0), token);
        }

        // Initialize the denormalized weight sum to ONE. This value can only be changed by adding or removing tokens.
        _denormWeightSum = FixedPoint.ONE;

        uint256 currentTime = block.timestamp;
        _startGradualWeightChange(
            currentTime,
            currentTime,
            params.normalizedWeights,
            params.normalizedWeights,
            params.tokens
        );

        _poolState = ManagedPoolSwapFeesLib.startGradualSwapFeeChange(
            _poolState,
            currentTime,
            currentTime,
            params.swapFeePercentage,
            params.swapFeePercentage
        );

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction).
        _setSwapEnabled(params.swapEnabledOnStart);

        // If true, only addresses on the manager-controlled allowlist may join the pool.
        _setMustAllowlistLPs(params.mustAllowlistLPs);
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

    function _getNormalizedWeight(IERC20 token, uint256 weightChangeProgress) internal view override returns (uint256) {
        return ManagedPoolTokenLib.getTokenWeight(_getTokenData(token), weightChangeProgress, _denormWeightSum);
    }

    // This could be simplified by simply iteratively calling _getNormalizedWeight(), but this routine is
    // called very frequently, so we are optimizing for runtime performance.
    function _getNormalizedWeights(IERC20[] memory tokens)
        internal
        view
        override
        returns (uint256[] memory normalizedWeights)
    {
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

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
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
     * Since, unlike with swap fee updates, we do not generally want to allow instantanous weight changes,
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
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        InputHelpers.ensureInputLengthMatch(tokens.length, endWeights.length);

        startTime = GradualValueChange.resolveStartTime(startTime, endTime);

        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(tokens), endWeights, tokens);
    }

    /**
     * @dev When calling updateWeightsGradually again during an update, reset the start weights to the current weights,
     * if necessary.
     */
    function _startGradualWeightChange(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory startWeights,
        uint256[] memory endWeights,
        IERC20[] memory tokens
    ) internal {
        uint256 normalizedSum;

        uint256 denormWeightSum = _denormWeightSum;
        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);
            normalizedSum = normalizedSum.add(endWeight);

            IERC20 token = tokens[i];
            _tokenState[token] = ManagedPoolTokenLib.setTokenWeight(
                _tokenState[token],
                startWeights[i],
                endWeight,
                denormWeightSum
            );
        }

        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = ManagedPoolStorageLib.setWeightChangeData(_poolState, startTime, endTime);

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    // Swap Enabled

    /**
     * @notice Returns whether swaps are enabled.
     */
    function getSwapEnabled() public view returns (bool) {
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

    /**
     * @notice Setter for the management swap fee percentage.
     * @dev Attempting to collect swap fees in excess of the maximum permitted percentage will revert.
     * Emits the ManagementSwapFeePercentageChanged event. This is a permissioned function.
     * @param managementSwapFeePercentage - The new management swap fee percentage.
     */
    function setManagementSwapFeePercentage(uint256 managementSwapFeePercentage)
        external
        override
        authenticate
        whenNotPaused
    {
        _setManagementSwapFeePercentage(managementSwapFeePercentage);
    }

    function _setManagementSwapFeePercentage(uint256 managementSwapFeePercentage) private {
        _require(
            managementSwapFeePercentage <= _MAX_MANAGEMENT_SWAP_FEE_PERCENTAGE,
            Errors.MAX_MANAGEMENT_SWAP_FEE_PERCENTAGE
        );

        _managementSwapFeePercentage = managementSwapFeePercentage;
        emit ManagementSwapFeePercentageChanged(managementSwapFeePercentage);
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

    // Swap overrides - revert unless swaps are enabled

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal override returns (uint256) {
        uint256 tokenInWeight;
        uint256 tokenOutWeight;
        {
            // Enter new scope to avoid stack-too-deep

            bytes32 poolState = _poolState;
            _require(ManagedPoolStorageLib.getSwapsEnabled(poolState), Errors.SWAPS_DISABLED);

            uint256 weightChangeProgress = ManagedPoolStorageLib.getGradualWeightChangeProgress(poolState);

            tokenInWeight = _getNormalizedWeight(swapRequest.tokenIn, weightChangeProgress);
            tokenOutWeight = _getNormalizedWeight(swapRequest.tokenOut, weightChangeProgress);
        }

        // balances (and swapRequest.amount) are already upscaled by BaseWeightedPool.onSwap
        uint256 amountOut = WeightedMath._calcOutGivenIn(
            currentBalanceTokenIn,
            tokenInWeight,
            currentBalanceTokenOut,
            tokenOutWeight,
            swapRequest.amount
        );

        // We can calculate the invariant growth ratio more easily using the ratios of the Pool's balances before and
        // after the trade.
        //
        // invariantGrowthRatio = invariant after trade / invariant before trade
        //                      = (x + a_in)^w1 * (y - a_out)^w2 / (x^w1 * y^w2)
        //                      = (1 + a_in/x)^w1 * (1 - a_out/y)^w2
        uint256 invariantGrowthRatio = WeightedMath._calculateTwoTokenInvariant(
            tokenInWeight,
            tokenOutWeight,
            FixedPoint.ONE.add(_addSwapFeeAmount(swapRequest.amount).divDown(currentBalanceTokenIn)),
            FixedPoint.ONE.sub(amountOut.divDown(currentBalanceTokenOut))
        );

        _payProtocolAndManagementFees(invariantGrowthRatio);

        return amountOut;
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal override returns (uint256) {
        uint256 tokenInWeight;
        uint256 tokenOutWeight;
        {
            // Enter new scope to avoid stack-too-deep

            bytes32 poolState = _poolState;
            _require(ManagedPoolStorageLib.getSwapsEnabled(poolState), Errors.SWAPS_DISABLED);

            uint256 weightChangeProgress = ManagedPoolStorageLib.getGradualWeightChangeProgress(poolState);

            tokenInWeight = _getNormalizedWeight(swapRequest.tokenIn, weightChangeProgress);
            tokenOutWeight = _getNormalizedWeight(swapRequest.tokenOut, weightChangeProgress);
        }

        // balances (and swapRequest.amount) are already upscaled by BaseWeightedPool.onSwap
        uint256 amountIn = WeightedMath._calcInGivenOut(
            currentBalanceTokenIn,
            tokenInWeight,
            currentBalanceTokenOut,
            tokenOutWeight,
            swapRequest.amount
        );

        // We can calculate the invariant growth ratio more easily using the ratios of the Pool's balances before and
        // after the trade.
        //
        // invariantGrowthRatio = invariant after trade / invariant before trade
        //                      = (x + a_in)^w1 * (y - a_out)^w2 / (x^w1 * y^w2)
        //                      = (1 + a_in/x)^w1 * (1 - a_out/y)^w2
        uint256 invariantGrowthRatio = WeightedMath._calculateTwoTokenInvariant(
            tokenInWeight,
            tokenOutWeight,
            FixedPoint.ONE.add(_addSwapFeeAmount(amountIn).divDown(currentBalanceTokenIn)),
            FixedPoint.ONE.sub(swapRequest.amount.divDown(currentBalanceTokenOut))
        );

        _payProtocolAndManagementFees(invariantGrowthRatio);

        return amountIn;
    }

    /**
     * @notice Returns the management swap fee percentage as an 18-decimal fixed point number.
     */
    function getManagementSwapFeePercentage() external view returns (uint256) {
        return _managementSwapFeePercentage;
    }

    function _payProtocolAndManagementFees(uint256 invariantGrowthRatio) private {
        // Calculate total BPT for the protocol and management fee
        // The management fee percentage applies to the remainder,
        // after the protocol fee has been collected.
        // So totalFee = protocolFee + (1 - protocolFee) * managementFee
        uint256 protocolSwapFeePercentage = getProtocolFeePercentageCache(ProtocolFeeType.SWAP);
        uint256 managementSwapFeePercentage = _managementSwapFeePercentage;

        if (protocolSwapFeePercentage == 0 && managementSwapFeePercentage == 0) {
            return;
        }

        // Fees are bounded, so we don't need checked math
        uint256 totalFeePercentage = protocolSwapFeePercentage +
            (FixedPoint.ONE - protocolSwapFeePercentage).mulDown(managementSwapFeePercentage);

        // No other balances are changing, so the other terms in the invariant will cancel out
        // when computing the ratio. So this partial invariant calculation is sufficient.
        // We pass the same value for total supply twice as we're measuring over a period in which the total supply
        // has not changed.
        uint256 supply = totalSupply();
        uint256 totalBptAmount = InvariantGrowthProtocolSwapFees.calcDueProtocolFees(
            invariantGrowthRatio,
            supply,
            supply,
            totalFeePercentage
        );

        // Calculate the portion of the total fee due the protocol
        // If the protocol fee were 30% and the manager fee 10%, the protocol would take 30% first.
        // Then the manager would take 10% of the remaining 70% (that is, 7%), for a total fee of 37%
        // The protocol would then earn 0.3/0.37 ~=81% of the total fee,
        // and the manager would get 0.1/0.75 ~=13%.
        uint256 protocolBptAmount = totalBptAmount.mulUp(protocolSwapFeePercentage.divUp(totalFeePercentage));

        _payProtocolFees(protocolBptAmount);

        // Pay the remainder in management fees
        // This goes to the controller, which needs to be able to withdraw them
        if (managementSwapFeePercentage > 0) {
            _mintPoolTokens(getOwner(), totalBptAmount.sub(protocolBptAmount));
        }
    }

    // Initialize

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, scalingFactors.length);
        _upscaleArray(amountsIn, scalingFactors);

        uint256 invariantAfterJoin = WeightedMath._calculateInvariant(getNormalizedWeights(), amountsIn);

        // Set the initial BPT to the value of the invariant times the number of tokens. This makes BPT supply more
        // consistent in Pools with similar compositions but different number of tokens.
        uint256 bptAmountOut = Math.mul(invariantAfterJoin, amountsIn.length);

        // We want to start collecting AUM fees from this point onwards. Prior to initialization the Pool holds no funds
        // so naturally charges no AUM fees.
        _lastAumFeeCollectionTimestamp = block.timestamp;

        return (bptAmountOut, amountsIn);
    }

    // Join/Exit hooks

    function _beforeJoinExit(uint256[] memory, uint256[] memory) internal override returns (uint256) {
        // The AUM fee calculation is based on inflating the Pool's BPT supply by a target rate.
        // We then must collect AUM fees whenever joining or exiting the pool to ensure that LPs only pay AUM fees
        // for the period during which they are an LP within the pool: otherwise an LP could shift their share of the
        // AUM fees onto the remaining LPs in the pool by exiting before they were paid.
        uint256 supplyBeforeFeeCollection = totalSupply();
        (uint256 protocolAUMFees, uint256 managerAUMFees) = _collectAumManagementFees(supplyBeforeFeeCollection);

        return supplyBeforeFeeCollection.add(protocolAUMFees + managerAUMFees);
    }

    /**
     * @dev Dispatch code which decodes the provided userdata to perform the specified join type.
     */
    function _doJoin(
        address sender,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        // If swaps are disabled, only proportional joins are allowed. All others involve implicit swaps, and alter
        // token prices.
        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(
            getSwapEnabled() || kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        // Check allowlist for LPs, if applicable
        _require(isAllowedAddress(sender), Errors.ADDRESS_NOT_ALLOWLISTED);

        if (kind == WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return
                WeightedJoinsLib.joinExactTokensInForBPTOut(
                    balances,
                    normalizedWeights,
                    scalingFactors,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(_poolState),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return
                WeightedJoinsLib.joinTokenInForExactBPTOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(_poolState),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return WeightedJoinsLib.joinAllTokensInForExactBPTOut(balances, totalSupply, userData);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function _doExit(
        address sender,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        // If swaps are disabled, only proportional exits are allowed. All others involve implicit swaps, and alter
        // token prices.
        // Removing tokens is also allowed, as that action can only be performed by the manager, who is assumed to
        // perform sensible checks.
        WeightedPoolUserData.ExitKind kind = userData.exitKind();
        _require(
            getSwapEnabled() ||
                kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT ||
                kind == WeightedPoolUserData.ExitKind.REMOVE_TOKEN,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        // Note that we do not perform any check on the LP allowlist here. LPs must always be able to exit the pool
        // and enforcing the allowlist would allow the manager to perform DOS attacks on LPs.

        return
            kind == WeightedPoolUserData.ExitKind.REMOVE_TOKEN
                ? _doExitRemoveToken(sender, balances, userData)
                : super._doExit(sender, balances, normalizedWeights, scalingFactors, totalSupply, userData);
    }

    function _doExitRemoveToken(
        address sender,
        uint256[] memory balances,
        bytes memory userData
    ) private view whenNotPaused returns (uint256, uint256[] memory) {
        // This exit function is disabled if the contract is paused.

        // This exit function can only be called by the Pool itself - the authorization logic that governs when that
        // call can be made resides in removeToken.
        _require(sender == address(this), Errors.UNAUTHORIZED_EXIT);

        uint256 tokenIndex = userData.removeToken();

        // No BPT is required to remove the token - it is up to the caller to determine under which conditions removing
        // a token makes sense, and if e.g. burning BPT is required.
        uint256 bptAmountIn = 0;

        uint256[] memory amountsOut = new uint256[](balances.length);
        amountsOut[tokenIndex] = balances[tokenIndex];

        return (bptAmountIn, amountsOut);
    }

    // Add/Remove tokens

    /**
     * @notice Adds a token to the Pool's list of tradeable tokens. This is a permissioned function.
     *
     * @dev By adding a token to the Pool's composition, the weights of all other tokens will be decreased. The new
     * token will have no balance - it is up to the controller to provide some immediately after calling this function.
     *
     * Token addition is forbidden during a weight change, or if one is scheduled to happen in the future.
     *
     * The caller may additionally pass a non-zero `mintAmount` to have some BPT be minted for them, which might be
     * useful in some scenarios to account for the fact that the Pool will have more tokens.
     *
     * Emits the TokenAdded event.
     *
     * @param token - The ERC20 token to be added to the Pool.
     * @param normalizedWeight - The normalized weight of `token` relative to the other tokens in the Pool.
     * @param mintAmount - The amount of BPT to be minted as a result of adding `token` to the Pool.
     * @param recipient - The address to receive the BPT minted by the Pool.
     */
    function addToken(
        IERC20 token,
        uint256 normalizedWeight,
        uint256 mintAmount,
        address recipient
    ) external authenticate whenNotPaused {
        // To reduce the complexity of weight interactions, tokens cannot be removed during or before a weight change.
        // Checking for the validity of the new weight would otherwise be much more complicated.
        _ensureNoWeightChange();

        // We need to check that both the new weight is valid, and that it won't make any of the existing weights
        // invalid.
        uint256 weightSumAfterAdd = _validateNewWeight(normalizedWeight);

        // Adding the new token to the pool decreases all other normalized weights to 'make room' for the new one. This
        // is achieved efficiently by simply updating the sum of the denormalized weights.
        _denormWeightSum = weightSumAfterAdd;

        // Finally, we store the new token's weight and scaling factor.
        _tokenState[token] = ManagedPoolTokenLib.initializeTokenState(token, normalizedWeight, weightSumAfterAdd);
        _totalTokensCache += 1;

        PoolRegistrationLib.registerToken(getVault(), getPoolId(), token, address(0));

        // Note that the Pool is now in an invalid state, since one of its tokens has a balance of zero (making the
        // invariant also zero).

        if (mintAmount > 0) {
            _mintPoolTokens(recipient, mintAmount);
        }

        emit TokenAdded(token, normalizedWeight);
    }

    function _validateNewWeight(uint256 normalizedWeight) private view returns (uint256) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        // Sanity check that the new token will make up less than 100% of the Pool.
        _require(normalizedWeight < FixedPoint.ONE, Errors.MAX_WEIGHT);
        // Make sure the new token is above the minimum weight.
        _require(normalizedWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

        uint256 numTokens = tokens.length;
        _require(numTokens + 1 <= _getMaxTokens(), Errors.MAX_TOKENS);

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
     * @dev Removes a token from the Pool's composition, withdraws all funds from the Vault (sending them to
     * `recipient`), and finally adjusts the weights of all other tokens.
     *
     * Tokens can only be removed if the Pool has more than 2 tokens, as it can never have fewer than 2. Token removal
     * is also forbidden during a weight change, or if one is scheduled to happen in the future.
     *
     * Emits the TokenRemoved event. This is a permissioned function.
     *
     * The caller may additionally pass a non-zero `burnAmount` to burn some of their BPT, which might be useful
     * in some scenarios to account for the fact that the Pool now has fewer tokens. This is a permissioned function.
     * @param token - The ERC20 token to be removed from the Pool.
     * @param recipient - The address to receive the Pool's balance of `token` after it is removed.
     * @param burnAmount - The amount of BPT to be burned after removing `token` from the Pool.
     * @param minAmountOut - Will revert if the number of tokens transferred from the Vault is less than this value.
     * @return The amount of tokens the Pool held, sent to `recipient`.
     */
    function removeToken(
        IERC20 token,
        address recipient,
        uint256 burnAmount,
        uint256 minAmountOut
    ) external authenticate nonReentrant whenNotPaused returns (uint256) {
        // We require the pool to be initialized (shown by the total supply being nonzero) in order to remove a token,
        // maintaining the behaviour that no exits can occur before the pool has been initialized.
        // This prevents the AUM fee calculation being triggered before the pool contains any assets.
        _require(totalSupply() > 0, Errors.UNINITIALIZED);

        // To reduce the complexity of weight interactions, tokens cannot be removed during or before a weight change.
        _ensureNoWeightChange();

        // Exit the pool, returning the full balance of the token to the recipient
        (IERC20[] memory tokens, uint256[] memory unscaledBalances, ) = getVault().getPoolTokens(getPoolId());
        _require(tokens.length > 2, Errors.MIN_TOKENS);

        // Reverts if the token does not exist in the pool.
        uint256 tokenIndex = _findTokenIndex(tokens, token);
        uint256 tokenBalance = unscaledBalances[tokenIndex];
        uint256 tokenNormalizedWeight = _getNormalizedWeight(
            token,
            ManagedPoolStorageLib.getGradualWeightChangeProgress(_poolState)
        );

        // We first perform a special exit operation, which will withdraw the entire token balance from the Vault.
        // Only the Pool itself is authorized to initiate this kind of exit.
        uint256[] memory minAmountsOut = new uint256[](tokens.length);
        minAmountsOut[tokenIndex] = minAmountOut;

        // Note that this exit will trigger collection of the AUM fees payable up to now.
        getVault().exitPool(
            getPoolId(),
            address(this),
            payable(recipient),
            IVault.ExitPoolRequest({
                assets: _asIAsset(tokens),
                minAmountsOut: minAmountsOut,
                userData: abi.encode(WeightedPoolUserData.ExitKind.REMOVE_TOKEN, tokenIndex),
                toInternalBalance: false
            })
        );

        // The Pool is now in an invalid state, since one of its tokens has a balance of zero (making the invariant also
        // zero). We immediately deregister the emptied-out token to restore a valid state.
        // Since all non-view Vault functions are non-reentrant, and we make no external calls between the two Vault
        // calls (`exitPool` and `deregisterTokens`), it is impossible for any actor to interact with the Pool while it
        // is in this inconsistent state (except for view calls).
        PoolRegistrationLib.deregisterToken(getVault(), getPoolId(), token);

        // Now all we need to do is delete the removed token's entry and update the sum of denormalized weights to scale
        // all other token weights accordingly.
        // Clean up data structures and update the token count
        delete _tokenState[token];
        _denormWeightSum -= tokenNormalizedWeight.mulUp(_denormWeightSum);

        _totalTokensCache = tokens.length - 1;

        if (burnAmount > 0) {
            _burnPoolTokens(msg.sender, burnAmount);
        }

        emit TokenRemoved(token, tokenNormalizedWeight, tokenBalance);

        return tokenBalance;
    }

    // Scaling Factors

    function _scalingFactor(IERC20 token) internal view override returns (uint256) {
        return ManagedPoolTokenLib.getTokenScalingFactor(_getTokenData(token));
    }

    function _scalingFactors() internal view override returns (uint256[] memory scalingFactors) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
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
        // We do not allow an `_onEnableRecoveryMode()` hook as this may jeopardize the ability to enable Recovery mode.
        if (!enabled) _onDisableRecoveryMode();
    }

    function _onDisableRecoveryMode() internal override {
        // Recovery mode exits bypass the AUM fee calculation which means that in the case where the Pool is paused and
        // in Recovery mode for a period of time and then later returns to normal operation then AUM fees will be
        // charged to the remaining LPs for the full period. We then update the collection timestamp so that no AUM fees
        // are accrued over this period.
        _lastAumFeeCollectionTimestamp = block.timestamp;
    }

    // Misc

    function _getMaxTokens() internal pure returns (uint256) {
        return _MAX_MANAGED_TOKENS;
    }

    function _getTotalTokens() internal view override returns (uint256) {
        return _totalTokensCache;
    }

    function _getTokenData(IERC20 token) private view returns (bytes32 tokenData) {
        tokenData = _tokenState[token];

        // A valid token can't be zero (must have non-zero weights)
        _require(tokenData != 0, Errors.INVALID_TOKEN);
    }

    /**
     * @dev Enumerates all ownerOnly functions in Managed Pool.
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(ManagedPool.updateWeightsGradually.selector)) ||
            (actionId == getActionId(ManagedPool.updateSwapFeeGradually.selector)) ||
            (actionId == getActionId(ManagedPool.setSwapEnabled.selector)) ||
            (actionId == getActionId(ManagedPool.setSwapFeePercentage.selector)) ||
            (actionId == getActionId(ManagedPool.addAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPool.removeAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPool.setMustAllowlistLPs.selector)) ||
            (actionId == getActionId(ManagedPool.addToken.selector)) ||
            (actionId == getActionId(ManagedPool.removeToken.selector)) ||
            (actionId == getActionId(ManagedPool.setManagementSwapFeePercentage.selector)) ||
            (actionId == getActionId(ManagedPool.setManagementAumFeePercentage.selector)) ||
            (actionId == getActionId(BasePool.setAssetManagerPoolConfig.selector));
    }
}
