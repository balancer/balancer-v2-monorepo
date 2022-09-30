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

import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/InvariantGrowthProtocolSwapFees.sol";
import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/ProtocolFeeCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/protocol-fees/ProtocolAUMFees.sol";

import "../lib/GradualValueChange.sol";
import "../WeightedMath.sol";

import "./vendor/BasePool.sol";

import "./ManagedPoolStorageLib.sol";
import "./ManagedPoolTokenLib.sol";
import "./ManagedPoolAddRemoveTokenLib.sol";

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

    // The swap fee cannot be 100%: calculations that divide by (1-fee) would revert with division by zero.
    // Swap fees close to 100% can still cause reverts when performing join/exit swaps, if the calculated fee
    // amounts exceed the pool's token balances in the Vault. 80% is a very high, but relatively safe maximum value.
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 80e16; // 80%

    uint256 private constant _MIN_SWAP_FEE_PERCENTAGE = 1e12; // 0.0001%

    uint256 private constant _MAX_MANAGEMENT_AUM_FEE_PERCENTAGE = 1e17; // 10%

    // Stores commonly used Pool state.
    // This slot is preferred for gas-sensitive operations as it is read in all joins, swaps and exits,
    // and therefore warm.
    // See `ManagedPoolStorageLib.sol` for data layout.
    bytes32 private _poolState;

    // Store scaling factor and start/end normalized weights for each token.
    // See `ManagedPoolTokenLib.sol` for data layout.
    mapping(IERC20 => bytes32) private _tokenState;

    // Store the circuit breaker configuration for each token.
    // See `CircuitBreakerLib.sol` for data layout.
    mapping(IERC20 => bytes32) private _circuitBreakerState;

    // If mustAllowlistLPs is enabled, this is the list of addresses allowed to join the pool
    mapping(address => bool) private _allowedAddresses;

    // Percentage of the pool's TVL to pay as management AUM fees over the course of a year.
    uint256 private _managementAumFeePercentage;

    // Timestamp of the most recent collection of management AUM fees.
    // Note that this is only initialized the first time fees are collected.
    uint256 internal _lastAumFeeCollectionTimestamp;

    // Event declarations

    event GradualSwapFeeUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    );
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
        uint256 aumFeeId;
    }

    constructor(NewPoolParams memory params, IProtocolFeePercentagesProvider protocolFeeProvider)
        ProtocolFeeCache(
            protocolFeeProvider,
            ProviderFeeIDs({ swap: ProtocolFeeType.SWAP, yield: ProtocolFeeType.YIELD, aum: params.aumFeeId })
        )
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

        _startGradualWeightChange(
            block.timestamp,
            block.timestamp,
            params.normalizedWeights,
            params.normalizedWeights,
            params.tokens
        );

        _startGradualSwapFeeChange(
            block.timestamp,
            block.timestamp,
            params.swapFeePercentage,
            params.swapFeePercentage
        );

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction).
        _setSwapEnabled(params.swapEnabledOnStart);

        // If true, only addresses on the manager-controlled allowlist may join the pool.
        _setMustAllowlistLPs(params.mustAllowlistLPs);
    }

    function _getPoolState() internal view returns (bytes32) {
        return _poolState;
    }

    function _getTokenState(IERC20 token) internal view returns (bytes32) {
        return _tokenState[token];
    }

    // Virtual Supply

    /**
     * @notice Returns the number of tokens in circulation.
     * @dev For the majority of Pools this will simply be a wrapper around the `totalSupply` function, however
     * composable pools premint a large fraction of the BPT supply to place it in the Vault. In this situation we must
     * override this function to subtract off this balance of BPT to show the real amount of BPT in circulation.
     */
    function _getVirtualSupply() internal view virtual returns (uint256) {
        return totalSupply();
    }

    // Actual Supply

    /**
     * @notice Returns the effective BPT supply.
     *
     * @dev The Pool owes debt to the Protocol and the Pool's owner in the form of unminted BPT, which will be minted
     * immediately before the next join or exit. We need to take these into account since, even if they don't yet exist,
     *  they will effectively be included in any Pool operation that involves BPT.
     *
     * In the vast majority of cases, this function should be used instead of `totalSupply()`.
     */
    function getActualSupply() external view returns (uint256) {
        return _getActualSupply(_getVirtualSupply());
    }

    function _getActualSupply(uint256 virtualSupply) internal view returns (uint256) {
        if (ManagedPoolStorageLib.getRecoveryModeEnabled(_poolState)) {
            // If we're in recovery mode then we bypass any fee logic and perform an early return.
            return virtualSupply;
        }

        uint256 aumFeesAmount = ProtocolAUMFees.getAumFeesBptAmount(
            virtualSupply,
            block.timestamp,
            _lastAumFeeCollectionTimestamp,
            getManagementAumFeePercentage()
        );
        return virtualSupply.add(aumFeesAmount);
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
     * @notice Schedule a gradual swap fee update.
     * @dev The swap fee will change from the given starting value (which may or may not be the current
     * value) to the given ending fee percentage, over startTime to endTime.
     *
     * Note that calling this with a starting swap fee different from the current value will immediately change the
     * current swap fee to `startSwapFeePercentage`, before commencing the gradual change at `startTime`.
     * Emits the GradualSwapFeeUpdateScheduled event.
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
    ) external override authenticate whenNotPaused nonReentrant {
        _startGradualSwapFeeChange(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
    }

    function _validateSwapFeePercentage(uint256 swapFeePercentage) internal pure {
        _require(swapFeePercentage >= _MIN_SWAP_FEE_PERCENTAGE, Errors.MIN_SWAP_FEE_PERCENTAGE);
        _require(swapFeePercentage <= _MAX_SWAP_FEE_PERCENTAGE, Errors.MAX_SWAP_FEE_PERCENTAGE);
    }

    /**
     * @notice Encodes a gradual swap fee update into the Pool state in storage.
     * @param startTime - The timestamp when the swap fee change will begin.
     * @param endTime - The timestamp when the swap fee change will end (must be >= startTime).
     * @param startSwapFeePercentage - The starting value for the swap fee change.
     * @param endSwapFeePercentage - The ending value for the swap fee change. If the current timestamp >= endTime,
     * `getSwapFeePercentage()` will return this value.
     */
    function _startGradualSwapFeeChange(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) internal {
        _validateSwapFeePercentage(startSwapFeePercentage);
        _validateSwapFeePercentage(endSwapFeePercentage);

        startTime = GradualValueChange.resolveStartTime(startTime, endTime);

        _poolState = ManagedPoolStorageLib.setSwapFeeData(
            _poolState,
            startTime,
            endTime,
            startSwapFeePercentage,
            endSwapFeePercentage
        );

        emit GradualSwapFeeUpdateScheduled(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
    }

    // Token weights

    /**
     * @dev Returns all normalized weights, in the same order as the Pool's tokens.
     */
    function _getNormalizedWeights(IERC20[] memory tokens) internal view returns (uint256[] memory normalizedWeights) {
        uint256 weightChangeProgress = ManagedPoolStorageLib.getGradualWeightChangeProgress(_poolState);

        uint256 numTokens = tokens.length;
        normalizedWeights = new uint256[](numTokens);
        for (uint256 i = 0; i < numTokens; i++) {
            normalizedWeights[i] = ManagedPoolTokenLib.getTokenWeight(_tokenState[tokens[i]], weightChangeProgress);
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

        for (uint256 i = 0; i < totalTokens; i++) {
            (startWeights[i], endWeights[i]) = ManagedPoolTokenLib.getTokenStartAndEndWeights(_tokenState[tokens[i]]);
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
     * @param tokens - The tokens associated with the target weights (must match the current pool tokens).
     * @param endWeights - The target weights. If the current timestamp >= endTime, `getNormalizedWeights()`
     * will return these values.
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        IERC20[] memory tokens,
        uint256[] memory endWeights
    ) external override authenticate whenNotPaused nonReentrant {
        (IERC20[] memory actualTokens, ) = _getPoolTokens();
        InputHelpers.ensureInputLengthMatch(tokens.length, actualTokens.length, endWeights.length);

        for (uint256 i = 0; i < actualTokens.length; ++i) {
            _require(actualTokens[i] == tokens[i], Errors.TOKENS_MISMATCH);
        }

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

        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);
            normalizedSum = normalizedSum.add(endWeight);

            IERC20 token = tokens[i];
            _tokenState[token] = ManagedPoolTokenLib.setTokenWeight(_tokenState[token], startWeights[i], endWeight);
        }

        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = ManagedPoolStorageLib.setWeightChangeData(_poolState, startTime, endTime);

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
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
        uint256 supplyBeforeFeeCollection = _getVirtualSupply();
        if (supplyBeforeFeeCollection > 0) {
            amount = _collectAumManagementFees(supplyBeforeFeeCollection);
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
        uint256 supplyBeforeFeeCollection = _getVirtualSupply();
        if (supplyBeforeFeeCollection == 0) _revert(Errors.UNINITIALIZED);

        return _collectAumManagementFees(supplyBeforeFeeCollection);
    }

    /**
     * @dev Calculates the AUM fees accrued since the last collection and pays it to the pool manager.
     * This function is called automatically on joins and exits.
     */
    function _collectAumManagementFees(uint256 totalSupply) internal returns (uint256) {
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
            return 0;
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

        return bptAmount;
    }

    // Add/Remove tokens

    /**
     * @notice Adds a token to the Pool's list of tradeable tokens. This is a permissioned function.
     *
     * @dev By adding a token to the Pool's composition, the weights of all other tokens will be decreased. The new
     * token will have no balance - it is up to the owner to provide some immediately after calling this function.
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
     * @param tokenToAdd - The ERC20 token to be added to the Pool.
     * @param assetManager - The Asset Manager for the token.
     * @param tokenToAddNormalizedWeight - The normalized weight of `token` relative to the other tokens in the Pool.
     * @param mintAmount - The amount of BPT to be minted as a result of adding `token` to the Pool.
     * @param recipient - The address to receive the BPT minted by the Pool.
     */
    function addToken(
        IERC20 tokenToAdd,
        address assetManager,
        uint256 tokenToAddNormalizedWeight,
        uint256 mintAmount,
        address recipient
    ) external authenticate whenNotPaused nonReentrant {
        {
            // This complex operation might mint BPT, altering the supply. For simplicity, we forbid adding tokens before
            // initialization (i.e. before BPT is first minted). We must also collect AUM fees every time the BPT supply
            // changes. For consistency, we do this always, even if the amount to mint is zero.
            uint256 supply = _getVirtualSupply();
            _require(supply > 0, Errors.UNINITIALIZED);
            _collectAumManagementFees(supply);
        }

        (IERC20[] memory tokens, ) = _getPoolTokens();
        _require(tokens.length + 1 <= _MAX_TOKENS, Errors.MAX_TOKENS);

        // `ManagedPoolAddRemoveTokenLib.addToken` performs any necessary state updates in the Vault and returns
        // values necessary for the Pool to update its own state.
        (bytes32 tokenToAddState, IERC20[] memory newTokens, uint256[] memory newWeights) = ManagedPoolAddRemoveTokenLib
            .addToken(
            getVault(),
            getPoolId(),
            _poolState,
            tokens,
            _getNormalizedWeights(tokens),
            tokenToAdd,
            assetManager,
            tokenToAddNormalizedWeight
        );

        // Once we've updated the state in the Vault, we need to also update our own state. This is a two-step process,
        // since we need to:
        //  a) initialize the state of the new token
        //  b) adjust the weights of all other tokens

        // Initializing the new token is straightforward. The Pool itself doesn't track how many or which tokens it uses
        // (and relies instead on the Vault for this), so we simply store the new token-specific information.
        // Note that we don't need to check here that the weight is valid. We'll later call `_startGradualWeightChange`,
        // which will check the entire set of weights for correctness.
        _tokenState[tokenToAdd] = tokenToAddState;

        // `_startGradualWeightChange` will perform all required validation on the new weights, including minimum
        // weights, sum, etc., so we don't need to worry about that ourselves.
        // Note that this call will set the weight for `tokenToAdd`, which we've already done - that'll just be a no-op.
        _startGradualWeightChange(block.timestamp, block.timestamp, newWeights, newWeights, newTokens);

        if (mintAmount > 0) {
            _mintPoolTokens(recipient, mintAmount);
        }

        emit TokenAdded(tokenToAdd, tokenToAddNormalizedWeight);
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
     * @param tokenToRemove - The ERC20 token to be removed from the Pool.
     * @param burnAmount - The amount of BPT to be burned after removing `token` from the Pool.
     * @param sender - The address to burn BPT from.
     */
    function removeToken(
        IERC20 tokenToRemove,
        uint256 burnAmount,
        address sender
    ) external authenticate nonReentrant whenNotPaused {
        {
            // Add new scope to avoid stack too deep.

            // This complex operation might burn BPT, altering the supply. For simplicity, we forbid removing tokens
            // before initialization (i.e. before BPT is first minted). We must also collect AUM fees every time the
            // BPT supply changes. For consistency, we do this always, even if the amount to burn is zero.
            uint256 supply = _getVirtualSupply();
            _require(supply > 0, Errors.UNINITIALIZED);
            _collectAumManagementFees(supply);
        }

        (IERC20[] memory tokens, ) = _getPoolTokens();
        _require(tokens.length - 1 >= 2, Errors.MIN_TOKENS);

        // `ManagedPoolAddRemoveTokenLib.removeToken` performs any necessary state updates in the Vault and returns
        // values necessary for the Pool to update its own state.
        (IERC20[] memory newTokens, uint256[] memory newWeights) = ManagedPoolAddRemoveTokenLib.removeToken(
            getVault(),
            getPoolId(),
            _poolState,
            tokens,
            _getNormalizedWeights(tokens),
            tokenToRemove,
            ManagedPoolTokenLib.getTokenWeight(_tokenState[tokenToRemove], FixedPoint.ONE)
        );

        // Once we've updated the state in the Vault, we need to also update our own state. This is a two-step process,
        // since we need to:
        //  a) delete the state of the removed token
        //  b) adjust the weights of all other tokens

        // Deleting the old token is straightforward. The Pool itself doesn't track how many or which tokens it uses
        // (and relies instead on the Vault for this), so we simply delete the token-specific information.
        delete _tokenState[tokenToRemove];

        // `_startGradualWeightChange` will perform all required validation on the new weights, including minimum
        // weights, sum, etc., so we don't need to worry about that ourselves.
        _startGradualWeightChange(block.timestamp, block.timestamp, newWeights, newWeights, newTokens);

        if (burnAmount > 0) {
            // We disallow burning from the zero address, as that would allow potentially returning the Pool to the
            // uninitialized state.
            _require(sender != address(0), Errors.BURN_FROM_ZERO);
            _burnPoolTokens(sender, burnAmount);
        }

        // The Pool is now again in a valid state: by the time the zero valued token is deregistered, all internal Pool
        // state is updated.

        emit TokenRemoved(tokenToRemove);
    }

    // Scaling Factors

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

        _collectAumManagementFees(_getVirtualSupply());
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
