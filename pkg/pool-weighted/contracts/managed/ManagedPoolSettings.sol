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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IManagedPool.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeePercentagesProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/external-fees/InvariantGrowthProtocolSwapFees.sol";
import "@balancer-labs/v2-pool-utils/contracts/external-fees/ProtocolFeeCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/external-fees/ExternalAUMFees.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/VaultReentrancyLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/NewBasePool.sol";

import "../lib/GradualValueChange.sol";
import "../managed/CircuitBreakerStorageLib.sol";
import "../WeightedMath.sol";

import "./ManagedPoolStorageLib.sol";
import "./ManagedPoolAumStorageLib.sol";
import "./ManagedPoolTokenStorageLib.sol";
import "./ManagedPoolAddRemoveTokenLib.sol";

/**
 * @title Managed Pool Settings
 */
abstract contract ManagedPoolSettings is NewBasePool, ProtocolFeeCache, IManagedPool {
    // ManagedPool weights and swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WeightedPoolUserData for bytes;

    // State variables

    uint256 private constant _MIN_TOKENS = 2;
    // The upper bound is WeightedMath.MAX_WEIGHTED_TOKENS, but this is constrained by other factors, such as Pool
    // creation gas consumption.
    uint256 private constant _MAX_TOKENS = 50;

    // The swap fee cannot be 100%: calculations that divide by (1-fee) would revert with division by zero.
    // Swap fees close to 100% can still cause reverts when performing join/exit swaps, if the calculated fee
    // amounts exceed the pool's token balances in the Vault. 95% is a very high but safe maximum value, and we want to
    // be permissive to let the owner manage the Pool as they see fit.
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 95e16; // 95%

    // The same logic applies to the AUM fee.
    uint256 private constant _MAX_MANAGEMENT_AUM_FEE_PERCENTAGE = 95e16; // 95%

    // We impose a minimum swap fee to create some buy/sell spread, and prevent the Pool from being drained through
    // repeated interactions. We should not need this since we explicity always round favoring the Pool, but a minimum
    // swap fee adds an extra safeguard.
    uint256 private constant _MIN_SWAP_FEE_PERCENTAGE = 1e12; // 0.0001%

    // Stores commonly used Pool state.
    // This slot is preferred for gas-sensitive operations as it is read in all joins, swaps and exits,
    // and therefore warm.
    // See `ManagedPoolStorageLib.sol` for data layout.
    bytes32 private _poolState;

    // Stores state related to charging AUM fees.
    // See `ManagedPoolAUMStorageLib.sol` for data layout.
    bytes32 private _aumState;

    // Store scaling factor and start/end normalized weights for each token.
    // See `ManagedPoolTokenStorageLib.sol` for data layout.
    mapping(IERC20 => bytes32) private _tokenState;

    // Store the circuit breaker configuration for each token.
    // See `CircuitBreakerStorageLib.sol` for data layout.
    mapping(IERC20 => bytes32) private _circuitBreakerState;

    // If mustAllowlistLPs is enabled, this is the list of addresses allowed to join the pool
    mapping(address => bool) private _allowedAddresses;

    struct ManagedPoolSettingsParams {
        IERC20[] tokens;
        uint256[] normalizedWeights;
        uint256 swapFeePercentage;
        bool swapEnabledOnStart;
        bool mustAllowlistLPs;
        uint256 managementAumFeePercentage;
        uint256 aumFeeId;
    }

    /**
     * @dev Ensure we are not in a Vault context when this function is called, by attempting a no-op internal
     * balance operation. If we are already in a Vault transaction (e.g., a swap, join, or exit), the Vault's
     * reentrancy protection will cause this function to revert.
     *
     * Use this modifier with any function that can cause a state change in a pool and is either public itself,
     * or called by a public function *outside* a Vault operation (e.g., join, exit, or swap).
     * See https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345 for reference.
     */
    modifier whenNotInVaultContext() {
        _ensureNotInVaultContext();
        _;
    }

    /**
     * @dev Reverts if called in the middle of a Vault operation; has no effect otherwise.
     */
    function _ensureNotInVaultContext() private view {
        VaultReentrancyLib.ensureNotInVaultContext(getVault());
    }

    constructor(ManagedPoolSettingsParams memory params, IProtocolFeePercentagesProvider protocolFeeProvider)
        ProtocolFeeCache(
            protocolFeeProvider,
            ProviderFeeIDs({ swap: ProtocolFeeType.SWAP, yield: ProtocolFeeType.YIELD, aum: params.aumFeeId })
        )
    {
        uint256 totalTokens = params.tokens.length;
        _require(totalTokens >= _MIN_TOKENS, Errors.MIN_TOKENS);
        _require(totalTokens <= _MAX_TOKENS, Errors.MAX_TOKENS);

        InputHelpers.ensureInputLengthMatch(totalTokens, params.normalizedWeights.length);

        // Validate and set initial fees
        _setManagementAumFeePercentage(params.managementAumFeePercentage);

        // Initialize the tokens' states with their scaling factors and weights.
        for (uint256 i = 0; i < totalTokens; i++) {
            IERC20 token = params.tokens[i];
            _tokenState[token] = ManagedPoolTokenStorageLib.initializeTokenState(token, params.normalizedWeights[i]);
        }

        // This is technically a noop with regards to the tokens' weights in storage. However, it performs important
        // validation of the token weights (normalization / bounds checking), and emits an event for offchain services.
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

        // Joins and exits are enabled by default on start.
        _setJoinExitEnabled(true);
    }

    function _getPoolState() internal view returns (bytes32) {
        return _poolState;
    }

    function _getTokenState(IERC20 token) internal view returns (bytes32) {
        return _tokenState[token];
    }

    function _getCircuitBreakerState(IERC20 token) internal view returns (bytes32) {
        return _circuitBreakerState[token];
    }

    // Virtual Supply

    /**
     * @notice Returns the number of tokens in circulation.
     * @dev For the majority of Pools, this will simply be a wrapper around the `totalSupply` function. However,
     * composable pools premint a large fraction of the BPT supply and place it in the Vault. In this situation,
     * the override would subtract this BPT balance from the total to reflect the actual amount of BPT in circulation.
     */
    function _getVirtualSupply() internal view virtual returns (uint256);

    // Actual Supply

    /// @inheritdoc IManagedPool
    function getActualSupply() external view override returns (uint256) {
        return _getActualSupply(_getVirtualSupply());
    }

    function _getActualSupply(uint256 virtualSupply) internal view returns (uint256) {
        (uint256 aumFeePercentage, uint256 lastCollectionTimestamp) = getManagementAumFeeParams();
        uint256 aumFeesAmount = ExternalAUMFees.getAumFeesBptAmount(
            virtualSupply,
            block.timestamp,
            lastCollectionTimestamp,
            aumFeePercentage
        );
        return virtualSupply.add(aumFeesAmount);
    }

    // Swap fees

    /**
     * @notice Returns the current value of the swap fee percentage.
     * @dev Computes the current swap fee percentage, which can change every block if a gradual swap fee
     * update is in progress.
     */
    function getSwapFeePercentage() external view override returns (uint256) {
        return ManagedPoolStorageLib.getSwapFeePercentage(_poolState);
    }

    /// @inheritdoc IManagedPool
    function getGradualSwapFeeUpdateParams()
        external
        view
        override
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        )
    {
        return ManagedPoolStorageLib.getSwapFeeFields(_poolState);
    }

    /// @inheritdoc IManagedPool
    function updateSwapFeeGradually(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) external override authenticate whenNotPaused {
        _startGradualSwapFeeChange(
            GradualValueChange.resolveStartTime(startTime, endTime),
            endTime,
            startSwapFeePercentage,
            endSwapFeePercentage
        );
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
            normalizedWeights[i] = ManagedPoolTokenStorageLib.getTokenWeight(
                _tokenState[tokens[i]],
                weightChangeProgress
            );
        }
    }

    /// @inheritdoc IManagedPool
    function getNormalizedWeights() external view override returns (uint256[] memory) {
        (IERC20[] memory tokens, ) = _getPoolTokens();
        return _getNormalizedWeights(tokens);
    }

    /**
     * @dev Returns the normalized weight of a single token.
     */
    function _getNormalizedWeight(IERC20 token) internal view returns (uint256) {
        return
            ManagedPoolTokenStorageLib.getTokenWeight(
                _tokenState[token],
                ManagedPoolStorageLib.getGradualWeightChangeProgress(_poolState)
            );
    }

    /// @inheritdoc IManagedPool
    function getGradualWeightUpdateParams()
        external
        view
        override
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory startWeights,
            uint256[] memory endWeights
        )
    {
        (startTime, endTime) = ManagedPoolStorageLib.getWeightChangeFields(_poolState);

        (IERC20[] memory tokens, ) = _getPoolTokens();

        startWeights = new uint256[](tokens.length);
        endWeights = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            (startWeights[i], endWeights[i]) = ManagedPoolTokenStorageLib.getTokenStartAndEndWeights(
                _tokenState[tokens[i]]
            );
        }
    }

    /// @inheritdoc IManagedPool
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        IERC20[] memory tokens,
        uint256[] memory endWeights
    ) external override authenticate whenNotPaused {
        (IERC20[] memory actualTokens, ) = _getPoolTokens();
        InputHelpers.ensureInputLengthMatch(tokens.length, actualTokens.length, endWeights.length);

        for (uint256 i = 0; i < actualTokens.length; ++i) {
            _require(actualTokens[i] == tokens[i], Errors.TOKENS_MISMATCH);
        }

        _startGradualWeightChange(
            GradualValueChange.resolveStartTime(startTime, endTime),
            endTime,
            _getNormalizedWeights(tokens),
            endWeights,
            tokens
        );
    }

    /**
     * @dev Validate the end weights, and set the start weights. `updateWeightsGradually` passes in the current weights
     * as the start weights, so that calling updateWeightsGradually again during an update will not result in any
     * abrupt weight changes. Also update the pool state with the start and end times.
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
            _tokenState[token] = ManagedPoolTokenStorageLib.setTokenWeight(
                _tokenState[token],
                startWeights[i],
                endWeight
            );
        }

        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _poolState = ManagedPoolStorageLib.setWeightChangeData(_poolState, startTime, endTime);

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    // Join / Exit Enabled

    /// @inheritdoc IManagedPool
    function getJoinExitEnabled() external view override returns (bool) {
        return ManagedPoolStorageLib.getJoinExitEnabled(_poolState);
    }

    /// @inheritdoc IManagedPool
    function setJoinExitEnabled(bool joinExitEnabled) external override authenticate whenNotPaused {
        _setJoinExitEnabled(joinExitEnabled);
    }

    function _setJoinExitEnabled(bool joinExitEnabled) private {
        _poolState = ManagedPoolStorageLib.setJoinExitEnabled(_poolState, joinExitEnabled);

        emit JoinExitEnabledSet(joinExitEnabled);
    }

    // Swap Enabled

    /// @inheritdoc IManagedPool
    function getSwapEnabled() external view override returns (bool) {
        return ManagedPoolStorageLib.getSwapEnabled(_poolState);
    }

    /// @inheritdoc IManagedPool
    function setSwapEnabled(bool swapEnabled) external override authenticate whenNotPaused {
        _setSwapEnabled(swapEnabled);
    }

    function _setSwapEnabled(bool swapEnabled) private {
        _poolState = ManagedPoolStorageLib.setSwapEnabled(_poolState, swapEnabled);

        emit SwapEnabledSet(swapEnabled);
    }

    // LP Allowlist

    /// @inheritdoc IManagedPool
    function getMustAllowlistLPs() external view override returns (bool) {
        return ManagedPoolStorageLib.getLPAllowlistEnabled(_poolState);
    }

    /// @inheritdoc IManagedPool
    function isAddressOnAllowlist(address member) public view override returns (bool) {
        return _allowedAddresses[member];
    }

    /**
     * @notice Check an LP address against the allowlist.
     * @dev If the allowlist is not enabled, this returns true for every address.
     * @param poolState - The bytes32 representing the state of the pool.
     * @param member - The address to check against the allowlist.
     * @return - Whether the given address is allowed to join the pool.
     */
    function _isAllowedAddress(bytes32 poolState, address member) internal view returns (bool) {
        return !ManagedPoolStorageLib.getLPAllowlistEnabled(poolState) || isAddressOnAllowlist(member);
    }

    /// @inheritdoc IManagedPool
    function addAllowedAddress(address member) external override authenticate whenNotPaused {
        _require(!isAddressOnAllowlist(member), Errors.ADDRESS_ALREADY_ALLOWLISTED);

        _allowedAddresses[member] = true;
        emit AllowlistAddressAdded(member);
    }

    /// @inheritdoc IManagedPool
    function removeAllowedAddress(address member) external override authenticate whenNotPaused {
        _require(isAddressOnAllowlist(member), Errors.ADDRESS_NOT_ALLOWLISTED);

        delete _allowedAddresses[member];
        emit AllowlistAddressRemoved(member);
    }

    /// @inheritdoc IManagedPool
    function setMustAllowlistLPs(bool mustAllowlistLPs) external override authenticate whenNotPaused {
        _setMustAllowlistLPs(mustAllowlistLPs);
    }

    function _setMustAllowlistLPs(bool mustAllowlistLPs) private {
        _poolState = ManagedPoolStorageLib.setLPAllowlistEnabled(_poolState, mustAllowlistLPs);

        emit MustAllowlistLPsSet(mustAllowlistLPs);
    }

    // AUM management fees

    /// @inheritdoc IManagedPool
    function getManagementAumFeeParams()
        public
        view
        override
        returns (uint256 aumFeePercentage, uint256 lastCollectionTimestamp)
    {
        (aumFeePercentage, lastCollectionTimestamp) = ManagedPoolAumStorageLib.getAumFeeFields(_aumState);

        // If we're in recovery mode, set the fee percentage to zero so that we bypass any fee logic that might fail
        // and prevent LPs from exiting the pool.
        if (ManagedPoolStorageLib.getRecoveryModeEnabled(_poolState)) {
            aumFeePercentage = 0;
        }
    }

    /// @inheritdoc IManagedPool
    function setManagementAumFeePercentage(uint256 managementAumFeePercentage)
        external
        override
        authenticate
        whenNotPaused
        whenNotInVaultContext
        returns (uint256 amount)
    {
        // We want to prevent the pool manager from retroactively increasing the amount of AUM fees payable.
        // To prevent this, we perform a collection before updating the fee percentage.
        // This is only necessary if the pool has been initialized (which is indicated by a nonzero total supply).
        uint256 supplyBeforeFeeCollection = _getVirtualSupply();
        if (supplyBeforeFeeCollection > 0) {
            amount = _collectAumManagementFees(supplyBeforeFeeCollection);
        }

        _setManagementAumFeePercentage(managementAumFeePercentage);
    }

    function _setManagementAumFeePercentage(uint256 managementAumFeePercentage) private {
        _require(
            managementAumFeePercentage <= _MAX_MANAGEMENT_AUM_FEE_PERCENTAGE,
            Errors.MAX_MANAGEMENT_AUM_FEE_PERCENTAGE
        );

        _aumState = ManagedPoolAumStorageLib.setAumFeePercentage(_aumState, managementAumFeePercentage);
        emit ManagementAumFeePercentageChanged(managementAumFeePercentage);
    }

    /**
     * @notice Stores the current timestamp as the most recent collection of AUM fees.
     * @dev This function *must* be called after each collection of AUM fees.
     */
    function _updateAumFeeCollectionTimestamp() internal {
        _aumState = ManagedPoolAumStorageLib.setLastCollectionTimestamp(_aumState, block.timestamp);
    }

    /// @inheritdoc IManagedPool
    function collectAumManagementFees() external override whenNotPaused whenNotInVaultContext returns (uint256) {
        // It only makes sense to collect AUM fees after the pool is initialized (as before then the AUM is zero).
        // We can query if the pool is initialized by checking for a nonzero total supply.
        // Reverting here prevents zero value AUM fee collections causing bogus events.
        uint256 supply = _getVirtualSupply();
        _require(supply > 0, Errors.UNINITIALIZED);
        return _collectAumManagementFees(supply);
    }

    /**
     * @notice Calculates the AUM fees accrued since the last collection and pays it to the pool manager.
     * @dev The AUM fee calculation is based on inflating the Pool's BPT supply by a target rate. This assumes
     * a constant virtual supply between fee collections. To ensure proper accounting, we must therefore collect
     * AUM fees whenever the virtual supply of the Pool changes.
     *
     * This collection mints the difference between the virtual supply and the actual supply. By adding the amount of
     * BPT returned by this function to the virtual supply passed in, we may calculate the updated virtual supply
     * (which is equal to the actual supply).
     * @return bptAmount - The amount of BPT minted as AUM fees.
     */
    function _collectAumManagementFees(uint256 virtualSupply) internal returns (uint256) {
        (uint256 aumFeePercentage, uint256 lastCollectionTimestamp) = getManagementAumFeeParams();
        uint256 bptAmount = ExternalAUMFees.getAumFeesBptAmount(
            virtualSupply,
            block.timestamp,
            lastCollectionTimestamp,
            aumFeePercentage
        );

        // We always update last collection timestamp even when there is nothing to collect to ensure the state is kept
        // consistent.
        _updateAumFeeCollectionTimestamp();

        // Early return if either:
        // - AUM fee is disabled.
        // - no time has passed since the last collection.
        if (bptAmount == 0) {
            return 0;
        }

        // Split AUM fees between protocol and Pool manager. In low liquidity situations, rounding may result in a
        // managerBPTAmount of zero. In general, when splitting fees, LPs come first, followed by the protocol,
        // followed by the manager.
        uint256 protocolBptAmount = bptAmount.mulUp(getProtocolFeePercentageCache(ProtocolFeeType.AUM));
        uint256 managerBPTAmount = bptAmount.sub(protocolBptAmount);

        _payProtocolFees(protocolBptAmount);

        emit ManagementAumFeeCollected(managerBPTAmount);

        _mintPoolTokens(getOwner(), managerBPTAmount);

        return bptAmount;
    }

    // Add/Remove tokens

    /// @inheritdoc IManagedPool
    function addToken(
        IERC20 tokenToAdd,
        address assetManager,
        uint256 tokenToAddNormalizedWeight,
        uint256 mintAmount,
        address recipient
    ) external override authenticate whenNotPaused whenNotInVaultContext {
        {
            // This complex operation might mint BPT, altering the supply. For simplicity, we forbid adding tokens
            // before initialization (i.e. before BPT is first minted). We must also collect AUM fees every time the
            // BPT supply changes. For consistency, we do this always, even if the amount to mint is zero.
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

        // Once we've updated the state in the Vault, we also need to update our own state. This is a two-step process,
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

    /// @inheritdoc IManagedPool
    function removeToken(
        IERC20 tokenToRemove,
        uint256 burnAmount,
        address sender
    ) external override authenticate whenNotPaused whenNotInVaultContext {
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

        // Token removal is forbidden during a weight change or if one is scheduled so we can assume that
        // the weight change progress is 100%.
        uint256 tokenToRemoveNormalizedWeight = ManagedPoolTokenStorageLib.getTokenWeight(
            _tokenState[tokenToRemove],
            FixedPoint.ONE
        );

        // `ManagedPoolAddRemoveTokenLib.removeToken` performs any necessary state updates in the Vault and returns
        // values necessary for the Pool to update its own state.
        (IERC20[] memory newTokens, uint256[] memory newWeights) = ManagedPoolAddRemoveTokenLib.removeToken(
            getVault(),
            getPoolId(),
            _poolState,
            tokens,
            _getNormalizedWeights(tokens),
            tokenToRemove,
            tokenToRemoveNormalizedWeight
        );

        // Once we've updated the state in the Vault, we also need to update our own state. This is a two-step process,
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

    /// @inheritdoc IBasePool
    function getScalingFactors() external view override returns (uint256[] memory) {
        (IERC20[] memory tokens, ) = _getPoolTokens();
        return _scalingFactors(tokens);
    }

    function _scalingFactors(IERC20[] memory tokens) internal view returns (uint256[] memory scalingFactors) {
        uint256 numTokens = tokens.length;
        scalingFactors = new uint256[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = ManagedPoolTokenStorageLib.getTokenScalingFactor(_tokenState[tokens[i]]);
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

        // We skip fee collection until the Pool is initialized.
        uint256 supplyBeforeFeeCollection = _getVirtualSupply();
        if (supplyBeforeFeeCollection > 0) {
            _collectAumManagementFees(supplyBeforeFeeCollection);
        }
    }

    // Recovery Mode

    /// @inheritdoc IRecoveryMode
    function inRecoveryMode() public view override returns (bool) {
        return ManagedPoolStorageLib.getRecoveryModeEnabled(_poolState);
    }

    /**
     * @dev Sets the recoveryMode state, and emits the corresponding event.
     */
    function _setRecoveryMode(bool enabled) internal override {
        _poolState = ManagedPoolStorageLib.setRecoveryModeEnabled(_poolState, enabled);

        // Some pools need to update their state when leaving recovery mode to ensure proper functioning of the Pool.
        // We do not perform any state updates when entering recovery mode, as this may jeopardize the ability to
        // enable Recovery mode.
        if (!enabled) {
            // Recovery mode exits bypass the AUM fee calculation. This means that if the Pool is paused and in
            // Recovery mode for a period of time, then later returns to normal operation, AUM fees will be charged
            // to the remaining LPs for the full period. We then update the collection timestamp so that no AUM fees
            // are accrued over this period.
            _updateAumFeeCollectionTimestamp();
        }
    }

    // Circuit Breakers

    /// @inheritdoc IManagedPool
    function getCircuitBreakerState(IERC20 token)
        external
        view
        override
        returns (
            uint256 bptPrice,
            uint256 referenceWeight,
            uint256 lowerBound,
            uint256 upperBound,
            uint256 lowerBptPriceBound,
            uint256 upperBptPriceBound
        )
    {
        bytes32 circuitBreakerState = _circuitBreakerState[token];

        (bptPrice, referenceWeight, lowerBound, upperBound) = CircuitBreakerStorageLib.getCircuitBreakerFields(
            circuitBreakerState
        );

        uint256 normalizedWeight = _getNormalizedWeight(token);

        lowerBptPriceBound = CircuitBreakerStorageLib.getBptPriceBound(circuitBreakerState, normalizedWeight, true);
        upperBptPriceBound = CircuitBreakerStorageLib.getBptPriceBound(circuitBreakerState, normalizedWeight, false);

        // Restore the original unscaled BPT price passed in `setCircuitBreakers`.
        uint256 tokenScalingFactor = ManagedPoolTokenStorageLib.getTokenScalingFactor(_getTokenState(token));
        bptPrice = _upscale(bptPrice, tokenScalingFactor);

        // Also render the adjusted bounds as unscaled values.
        lowerBptPriceBound = _upscale(lowerBptPriceBound, tokenScalingFactor);
        upperBptPriceBound = _upscale(upperBptPriceBound, tokenScalingFactor);
    }

    /// @inheritdoc IManagedPool
    function setCircuitBreakers(
        IERC20[] memory tokens,
        uint256[] memory bptPrices,
        uint256[] memory lowerBoundPercentages,
        uint256[] memory upperBoundPercentages
    ) external override authenticate whenNotPaused {
        InputHelpers.ensureInputLengthMatch(tokens.length, lowerBoundPercentages.length, upperBoundPercentages.length);
        InputHelpers.ensureInputLengthMatch(tokens.length, bptPrices.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            _setCircuitBreaker(tokens[i], bptPrices[i], lowerBoundPercentages[i], upperBoundPercentages[i]);
        }
    }

    // Compute the reference values, then pass them along with the bounds to the library. The bptPrice must be
    // passed in from the caller, or it would be manipulable. We assume the bptPrice from the caller was computed
    // using the native (i.e., unscaled) token balance.
    function _setCircuitBreaker(
        IERC20 token,
        uint256 bptPrice,
        uint256 lowerBoundPercentage,
        uint256 upperBoundPercentage
    ) private {
        uint256 normalizedWeight = _getNormalizedWeight(token);
        // Fail if the token is not in the pool (or is the BPT token)
        _require(normalizedWeight != 0, Errors.INVALID_TOKEN);

        // The incoming BPT price (defined as actualSupply * weight / balance) will have been calculated dividing
        // by unscaled token balance, effectively multiplying the result by the scaling factor.
        // To correct this, we need to divide by it (downscaling).
        uint256 scaledBptPrice = _downscaleDown(
            bptPrice,
            ManagedPoolTokenStorageLib.getTokenScalingFactor(_getTokenState(token))
        );

        // The library will validate the lower/upper bounds
        _circuitBreakerState[token] = CircuitBreakerStorageLib.setCircuitBreaker(
            scaledBptPrice,
            normalizedWeight,
            lowerBoundPercentage,
            upperBoundPercentage
        );

        // Echo the unscaled BPT price in the event.
        emit CircuitBreakerSet(token, bptPrice, lowerBoundPercentage, upperBoundPercentage);
    }

    // Misc

    /**
     * @dev Enumerates all ownerOnly functions in Managed Pool.
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(ManagedPoolSettings.updateWeightsGradually.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.updateSwapFeeGradually.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setJoinExitEnabled.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setSwapEnabled.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.addAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.removeAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setMustAllowlistLPs.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.addToken.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.removeToken.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setManagementAumFeePercentage.selector)) ||
            (actionId == getActionId(ManagedPoolSettings.setCircuitBreakers.selector));
    }

    /**
     * @notice Returns the tokens in the Pool and their current balances.
     * @dev This function must be overridden to process these arrays according to the specific pool type.
     * A common example of this is in composable pools, as we may need to drop the BPT token and its balance.
     */
    function _getPoolTokens() internal view virtual returns (IERC20[] memory tokens, uint256[] memory balances);
}
