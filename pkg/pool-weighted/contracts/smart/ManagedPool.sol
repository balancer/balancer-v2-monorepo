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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableMap.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ArrayHelpers.sol";

import "@balancer-labs/v2-pool-utils/contracts/AumProtocolFeeCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";

import "../lib/GradualValueChange.sol";
import "../lib/WeightCompression.sol";

import "../BaseWeightedPool.sol";

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
contract ManagedPool is BaseWeightedPool, ProtocolFeeCache, AumProtocolFeeCache, ReentrancyGuard {
    // ManagedPool weights and swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;
    using WeightedPoolUserData for bytes;

    // State variables

    // The upper bound is WeightedMath.MAX_WEIGHTED_TOKENS, but this is constrained by other factors, such as Pool
    // creation gas consumption.
    uint256 private constant _MAX_MANAGED_TOKENS = 38;

    // The swap fee cannot be 100%: calculations that divide by (1-fee) would revert with division by zero.
    // Swap fees close to 100% can still cause reverts when performing join/exit swaps, if the calculated fee
    // amounts exceed the pool's token balances in the Vault. 80% is a very high, but relatively safe maximum value.
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 80e16; // 80%

    uint256 private constant _MAX_MANAGEMENT_SWAP_FEE_PERCENTAGE = 1e18; // 100%

    uint256 private constant _MAX_MANAGEMENT_AUM_FEE_PERCENTAGE = 1e17; // 10%

    // Use the _miscData slot in BasePool
    // The first 64 bits are reserved for the swap fee
    //
    // Store non-token-based values:
    // Start/end timestamps for gradual weight and swap fee updates
    // Start/end values of the swap fee (The MSB "start" swap fee corresponds to the reserved bits in BasePool,
    // and cannot be written from this contract.)
    // Flags for the LP allowlist and enabling/disabling trading
    // [ 64 bits  |  1 bit  |   1 bit   |  62 bits | 32 bits |  32 bits  |  32 bits |  32 bits  ]
    // [ swap fee | LP flag | swap flag | end swap | fee end | fee start | end wgt  | start wgt ]
    // |MSB                                                                                  LSB|
    uint256 private constant _WEIGHT_START_TIME_OFFSET = 0;
    uint256 private constant _WEIGHT_END_TIME_OFFSET = 32;
    uint256 private constant _FEE_START_TIME_OFFSET = 64;
    uint256 private constant _FEE_END_TIME_OFFSET = 96;
    uint256 private constant _END_SWAP_FEE_PERCENTAGE_OFFSET = 128;
    uint256 private constant _SWAP_ENABLED_OFFSET = 190;
    uint256 private constant _MUST_ALLOWLIST_LPS_OFFSET = 191;
    uint256 private constant _SWAP_FEE_PERCENTAGE_OFFSET = 192;

    // Store scaling factor and start/end denormalized weights for each token
    // Mapping should be more efficient than trying to compress it further
    // [ 123 bits |  5 bits  |  64 bits   |   64 bits    |
    // [ unused   | decimals | end denorm | start denorm |
    // |MSB                                           LSB|
    mapping(IERC20 => bytes32) private _tokenState;

    // Denormalized weights are stored using the WeightCompression library as a percentage of the maximum absolute
    // denormalized weight: independent of the current _denormWeightSum, which avoids having to recompute the denorm
    // weights as the sum changes.
    uint256 private constant _MAX_DENORM_WEIGHT = 1e22; // FP 10,000

    uint256 private constant _START_DENORM_WEIGHT_OFFSET = 0;
    uint256 private constant _END_DENORM_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 128;

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
    event GradualSwapFeeUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    );
    event TokenAdded(IERC20 indexed token, uint256 normalizedWeight, uint256 tokenAmountIn);
    event TokenRemoved(IERC20 indexed token, uint256 normalizedWeight, uint256 tokenAmountOut);

    // Making aumProtocolFeesCollector a constructor parameter would be more consistent with the intent
    // of NewPoolParams: it is supposed to be for parameters passed in by users. However, adding the
    // argument caused "stack too deep" errors in the constructor.
    struct NewPoolParams {
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] normalizedWeights;
        address[] assetManagers;
        uint256 swapFeePercentage;
        bool swapEnabledOnStart;
        bool mustAllowlistLPs;
        uint256 protocolSwapFeePercentage;
        uint256 managementSwapFeePercentage;
        uint256 managementAumFeePercentage;
        IAumProtocolFeesCollector aumProtocolFeesCollector;
    }

    constructor(
        NewPoolParams memory params,
        IVault vault,
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
            params.swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
            true
        )
        ProtocolFeeCache(vault, params.protocolSwapFeePercentage)
        AumProtocolFeeCache(params.aumProtocolFeesCollector)
    {
        uint256 totalTokens = params.tokens.length;
        InputHelpers.ensureInputLengthMatch(totalTokens, params.normalizedWeights.length, params.assetManagers.length);

        _totalTokensCache = totalTokens;

        // Validate and set initial fees
        _setManagementSwapFeePercentage(params.managementSwapFeePercentage);

        _setManagementAumFeePercentage(params.managementAumFeePercentage);

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

        _startGradualSwapFeeChange(currentTime, currentTime, params.swapFeePercentage, params.swapFeePercentage);

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction).
        _setSwapEnabled(params.swapEnabledOnStart);

        // If true, only addresses on the manager-controlled allowlist may join the pool.
        _setMustAllowlistLPs(params.mustAllowlistLPs);
    }

    /**
     * @notice Returns whether swaps are enabled.
     */
    function getSwapEnabled() public view returns (bool) {
        return _getMiscData().decodeBool(_SWAP_ENABLED_OFFSET);
    }

    /**
     * @notice Returns whether the allowlist for LPs is enabled.
     */
    function getMustAllowlistLPs() public view returns (bool) {
        return _getMiscData().decodeBool(_MUST_ALLOWLIST_LPS_OFFSET);
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
     * @notice Returns the management swap fee percentage as an 18-decimal fixed point number.
     */
    function getManagementSwapFeePercentage() public view returns (uint256) {
        return _managementSwapFeePercentage;
    }

    /**
     * @notice Returns the current value of the swap fee percentage.
     * @dev Computes the current swap fee percentage, which can change every block if a gradual swap fee
     * update is in progress.
     */
    function getSwapFeePercentage() public view virtual override returns (uint256) {
        (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        ) = _getSwapFeeFields();

        return
            GradualValueChange.getInterpolatedValue(startSwapFeePercentage, endSwapFeePercentage, startTime, endTime);
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
        (startTime, endTime, startSwapFeePercentage, endSwapFeePercentage) = _getSwapFeeFields();
    }

    function _getSwapFeeFields()
        private
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        )
    {
        // Load the current pool state from storage
        bytes32 poolState = _getMiscData();

        startTime = poolState.decodeUint(_FEE_START_TIME_OFFSET, 32);
        endTime = poolState.decodeUint(_FEE_END_TIME_OFFSET, 32);
        startSwapFeePercentage = poolState.decodeUint(_SWAP_FEE_PERCENTAGE_OFFSET, 64);
        endSwapFeePercentage = poolState.decodeUint(_END_SWAP_FEE_PERCENTAGE_OFFSET, 62);
    }

    function _setSwapFeePercentage(uint256 swapFeePercentage) internal virtual override {
        // Do not allow setting if there is an ongoing fee change
        uint256 currentTime = block.timestamp;
        bytes32 poolState = _getMiscData();

        uint256 endTime = poolState.decodeUint(_FEE_END_TIME_OFFSET, 32);
        if (currentTime < endTime) {
            uint256 startTime = poolState.decodeUint(_FEE_START_TIME_OFFSET, 32);
            _revert(
                currentTime < startTime ? Errors.SET_SWAP_FEE_PENDING_FEE_CHANGE : Errors.SET_SWAP_FEE_DURING_FEE_CHANGE
            );
        }

        _setSwapFeeData(currentTime, currentTime, swapFeePercentage);

        super._setSwapFeePercentage(swapFeePercentage);
    }

    /**
     * @notice Returns the management AUM fee percentage as an 18-decimal fixed point number.
     */
    function getManagementAumFeePercentage() public view returns (uint256) {
        return _managementAumFeePercentage;
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
        // Load current pool state from storage
        bytes32 poolState = _getMiscData();

        startTime = poolState.decodeUint(_WEIGHT_START_TIME_OFFSET, 32);
        endTime = poolState.decodeUint(_WEIGHT_END_TIME_OFFSET, 32);

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 totalTokens = tokens.length;

        startWeights = new uint256[](totalTokens);
        endWeights = new uint256[](totalTokens);

        uint256 denormWeightSum = _denormWeightSum;
        for (uint256 i = 0; i < totalTokens; i++) {
            bytes32 state = _tokenState[tokens[i]];

            startWeights[i] = _normalizeWeight(
                state.decodeUint(_START_DENORM_WEIGHT_OFFSET, 64).decompress(64, _MAX_DENORM_WEIGHT),
                denormWeightSum
            );
            endWeights[i] = _normalizeWeight(
                state.decodeUint(_END_DENORM_WEIGHT_OFFSET, 64).decompress(64, _MAX_DENORM_WEIGHT),
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

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return _MAX_MANAGED_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokensCache;
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
    ) external authenticate whenNotPaused nonReentrant {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        InputHelpers.ensureInputLengthMatch(tokens.length, endWeights.length);

        startTime = GradualValueChange.resolveStartTime(startTime, endTime);

        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights, tokens);
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
        _validateSwapFeePercentage(startSwapFeePercentage);
        _validateSwapFeePercentage(endSwapFeePercentage);

        startTime = GradualValueChange.resolveStartTime(startTime, endTime);

        _startGradualSwapFeeChange(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
    }

    function _validateSwapFeePercentage(uint256 swapFeePercentage) private pure {
        _require(swapFeePercentage >= _getMinSwapFeePercentage(), Errors.MIN_SWAP_FEE_PERCENTAGE);
        _require(swapFeePercentage <= _getMaxSwapFeePercentage(), Errors.MAX_SWAP_FEE_PERCENTAGE);
    }

    /**
     * @notice Adds an address to the LP allowlist.
     * @dev Will fail if the LP allowlist is not enabled, or the address is already allowlisted.
     * Emits the AllowlistAddressAdded event. This is a permissioned function.
     * @param member - The address to be added to the allowlist.
     */
    function addAllowedAddress(address member) external authenticate whenNotPaused {
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
    function removeAllowedAddress(address member) external authenticate whenNotPaused {
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
    function setMustAllowlistLPs(bool mustAllowlistLPs) external authenticate whenNotPaused {
        _setMustAllowlistLPs(mustAllowlistLPs);
    }

    function _setMustAllowlistLPs(bool mustAllowlistLPs) private {
        _setMiscData(_getMiscData().insertBool(mustAllowlistLPs, _MUST_ALLOWLIST_LPS_OFFSET));

        emit MustAllowlistLPsSet(mustAllowlistLPs);
    }

    /**
     * @notice Enable or disable trading.
     * @dev Emits the SwapEnabledSet event. This is a permissioned function.
     * @param swapEnabled - The new value of the swap enabled flag.
     */
    function setSwapEnabled(bool swapEnabled) external authenticate whenNotPaused {
        _setSwapEnabled(swapEnabled);
    }

    function _setSwapEnabled(bool swapEnabled) private {
        _setMiscData(_getMiscData().insertBool(swapEnabled, _SWAP_ENABLED_OFFSET));

        emit SwapEnabledSet(swapEnabled);
    }

    /**
     * @notice Adds a token to the Pool's list of tradeable tokens.
     * @dev Adds a token to the Pool's composition, sending funds to the Vault from `msg.sender`,
     * and adjusting the weights of all other tokens.
     *
     * When calling this function with particular values for `normalizedWeight` and `tokenAmountIn`,
     * the caller is stating that `tokenAmountIn` of the added token will correspond to a fraction `normalizedWeight`
     * of the Pool's total value after it is added. Choosing these values inappropriately could result in large
     * mispricings occurring between the new token and the existing assets in the Pool, causing loss of funds.
     *
     * Token addition is forbidden during a weight change, or if one is scheduled to happen in the future.
     *
     * The caller may additionally pass a non-zero `mintAmount` to have some BPT be minted for them, which might be
     * useful in some scenarios to account for the fact that the Pool now has more tokens.
     *
     * This function takes the token, and the normalizedWeight it should have in the pool after being added.
     * The stored (denormalized) weights of all other tokens remain unchanged, but `denormWeightSum` will increase,
     * such that the normalized weight of the new token will match the target value, and the normalized weights of
     * all other tokens will be reduced proportionately.
     *
     * Emits the TokenAdded event. This is a permissioned function.
     *
     * @param token - The ERC20 token to be added to the Pool.
     * @param normalizedWeight - The normalized weight of `token` relative to the other tokens in the Pool.
     * @param tokenAmountIn - The amount of `token` to be sent to the pool as its initial balance.
     * @param mintAmount - The amount of BPT to be minted as a result of adding `token` to the Pool.
     * @param recipient - The address to receive the BPT minted by the Pool.
     */
    function addToken(
        IERC20 token,
        uint256 normalizedWeight,
        uint256 tokenAmountIn,
        uint256 mintAmount,
        address recipient
    ) external authenticate whenNotPaused {
        (IERC20[] memory currentTokens, , ) = getVault().getPoolTokens(getPoolId());

        uint256 weightSumAfterAdd = _validateAddToken(currentTokens, normalizedWeight);

        // In order to add a token to a Pool we must perform a two step process:
        // - First, the new token must be registered in the Vault as belonging to this Pool.
        // - Second, a special join must be performed to seed the Pool with its initial balance of the new token.

        // We only allow the Pool to perform the special join mentioned above to ensure it only happens
        // as part of adding a new token to the Pool. The necessary tokens must then be held by the Pool.
        // Transferring these tokens from the caller before the registration step ensures reentrancy safety.
        token.transferFrom(msg.sender, address(this), tokenAmountIn);
        token.approve(address(getVault()), tokenAmountIn);

        _registerNewToken(token, normalizedWeight, weightSumAfterAdd);

        // The Pool is now in an invalid state, since one of its tokens has a balance of zero (making the invariant also
        // zero). We immediately perform a join using the newly added token to restore a valid state.
        // Since all non-view Vault functions are non-reentrant, and we make no external calls between the two Vault
        // calls (`registerTokens` and `joinPool`), it is impossible for any actor to interact with the Pool while it
        // is in this inconsistent state (except for view calls).

        // We now need the updated list of tokens in the Pool to construct the join call.
        // As we know that the new token will be appended to the end of the existing array of tokens, we can save gas
        // by constructing the updated list of tokens in memory rather than rereading from storage.
        IERC20[] memory tokensAfterAdd = _appendToken(currentTokens, token);

        // As described above, the new token corresponds the last position of the `maxAmountsIn` array.
        uint256[] memory maxAmountsIn = new uint256[](tokensAfterAdd.length);
        maxAmountsIn[tokensAfterAdd.length - 1] = tokenAmountIn;

        getVault().joinPool(
            getPoolId(),
            address(this),
            address(this),
            IVault.JoinPoolRequest({
                assets: _asIAsset(tokensAfterAdd),
                maxAmountsIn: maxAmountsIn,
                userData: abi.encode(WeightedPoolUserData.JoinKind.ADD_TOKEN, tokenAmountIn),
                fromInternalBalance: false
            })
        );

        // Adding the new token to the pool increases the total weight across all the Pool's tokens.
        // We then update the sum of denormalized weights used to account for this.
        _denormWeightSum = weightSumAfterAdd;

        if (mintAmount > 0) {
            _mintPoolTokens(recipient, mintAmount);
        }

        emit TokenAdded(token, normalizedWeight, tokenAmountIn);
    }

    function _validateAddToken(IERC20[] memory tokens, uint256 normalizedWeight) private view returns (uint256) {
        // Sanity check that the new token will make up less than 100% of the Pool.
        _require(normalizedWeight < FixedPoint.ONE, Errors.MAX_WEIGHT);
        // Make sure the new token is above the minimum weight.
        _require(normalizedWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

        // To reduce the complexity of weight interactions, tokens cannot be removed during or before a weight change.
        // Otherwise we'd have to reason about how changes in the weights of other tokens could affect the pricing
        // between them and the newly added token, etc.
        _ensureNoWeightChange();

        uint256 numTokens = tokens.length;
        _require(numTokens + 1 <= _getMaxTokens(), Errors.MAX_TOKENS);

        // The growth in the total weight of the pool can be easily calculated by:
        //
        // weightSumRatio = totalWeight / (totalWeight - newTokenWeight)
        //
        // As we're working with normalized weights, `totalWeight` is equal to 1.
        //
        // We can then easily calculate the new denormalized weight sum by applying this ratio to the old sum.
        uint256 weightSumAfterAdd = _denormWeightSum.mulUp(FixedPoint.ONE.divDown(FixedPoint.ONE - normalizedWeight));

        // We want to check if adding this new token results in any tokens falling below the minimum weight limit.
        // Adding a new token could cause one of the other tokens to be pushed below the minimum weight.
        // If any would fail this check, it would be the token with the lowest weight, so we search through all
        // tokens to find the minimum weight. We can delay decompressing the weight until after the search.
        uint256 minimumCompressedWeight = type(uint256).max;
        for (uint256 i = 0; i < numTokens; i++) {
            uint256 newCompressedWeight = _getTokenData(tokens[i]).decodeUint(_END_DENORM_WEIGHT_OFFSET, 64);
            if (newCompressedWeight < minimumCompressedWeight) {
                minimumCompressedWeight = newCompressedWeight;
            }
        }

        // Now we know the minimum weight we can decompress it and check that it doesn't get pushed below the minimum.
        _require(
            minimumCompressedWeight.decompress(64, _MAX_DENORM_WEIGHT) >=
                _denormalizeWeight(WeightedMath._MIN_WEIGHT, weightSumAfterAdd),
            Errors.MIN_WEIGHT
        );

        return weightSumAfterAdd;
    }

    function _registerNewToken(
        IERC20 token,
        uint256 normalizedWeight,
        uint256 newDenormWeightSum
    ) private {
        IERC20[] memory tokensToAdd = new IERC20[](1);
        tokensToAdd[0] = token;

        // Since we do not allow new tokens to be registered with asset managers,
        // pass an empty array for this parameter.
        getVault().registerTokens(getPoolId(), tokensToAdd, new address[](1));

        // `_encodeTokenState` performs an external call to `token` (to get its decimals). Nevertheless, this is
        // reentrancy safe. View functions are called in a STATICCALL context, and will revert if they modify state.
        _tokenState[token] = _encodeTokenState(token, normalizedWeight, normalizedWeight, newDenormWeightSum);
        _totalTokensCache += 1;
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

        // Exit the pool, returning the full balance of the token to the recipient
        (IERC20[] memory tokens, uint256[] memory unscaledBalances, ) = getVault().getPoolTokens(getPoolId());
        _require(tokens.length > 2, Errors.MIN_TOKENS);

        // To reduce the complexity of weight interactions, tokens cannot be removed during or before a weight change.
        _ensureNoWeightChange();

        // Reverts if the token does not exist in the pool.
        uint256 tokenIndex = _tokenAddressToIndex(tokens, token);
        uint256 tokenBalance = unscaledBalances[tokenIndex];
        uint256 tokenNormalizedWeight = _getNormalizedWeight(token);

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

        IERC20[] memory tokensToRemove = new IERC20[](1);
        tokensToRemove[0] = token;
        getVault().deregisterTokens(getPoolId(), tokensToRemove);

        // Now all we need to do is delete the removed token's entry and update the sum of denormalized weights to scale
        // all other token weights accordingly.
        // Clean up data structures and update the token count
        delete _tokenState[token];
        _denormWeightSum -= _denormalizeWeight(tokenNormalizedWeight, _denormWeightSum);

        _totalTokensCache = tokens.length - 1;

        if (burnAmount > 0) {
            _burnPoolTokens(msg.sender, burnAmount);
        }

        emit TokenRemoved(token, tokenNormalizedWeight, tokenBalance);

        return tokenBalance;
    }

    function _ensureNoWeightChange() private view {
        uint256 currentTime = block.timestamp;
        bytes32 poolState = _getMiscData();

        uint256 endTime = poolState.decodeUint(_WEIGHT_END_TIME_OFFSET, 32);
        if (currentTime < endTime) {
            uint256 startTime = poolState.decodeUint(_WEIGHT_START_TIME_OFFSET, 32);
            _revert(
                currentTime < startTime
                    ? Errors.CHANGE_TOKENS_PENDING_WEIGHT_CHANGE
                    : Errors.CHANGE_TOKENS_DURING_WEIGHT_CHANGE
            );
        }
    }

    /**
     * @notice Setter for the management swap fee percentage.
     * @dev Attempting to collect swap fees in excess of the maximum permitted percentage will revert.
     * Emits the ManagementSwapFeePercentageChanged event. This is a permissioned function.
     * @param managementSwapFeePercentage - The new management swap fee percentage.
     */
    function setManagementSwapFeePercentage(uint256 managementSwapFeePercentage) external authenticate whenNotPaused {
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
        authenticate
        whenNotPaused
        returns (uint256 amount)
    {
        // We want to prevent the pool manager from retroactively increasing the amount of AUM fees payable.
        // To prevent this, we perform a collection before updating the fee percentage.
        // This is only necessary if the pool has been initialized (which is indicated by a nonzero total supply).
        if (totalSupply() > 0) {
            amount = _collectAumManagementFees();
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
    function collectAumManagementFees() external returns (uint256) {
        // It only makes sense to collect AUM fees after the pool is initialized (as before then the AUM is zero).
        // We can query if the pool is initialized by checking for a nonzero total supply.
        // Reverting here prevents zero value AUM fee collections causing bogus events.
        if (totalSupply() == 0) _revert(Errors.UNINITIALIZED);

        return _collectAumManagementFees();
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return _readScalingFactor(_getTokenData(token));
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        scalingFactors = new uint256[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = _readScalingFactor(_tokenState[tokens[i]]);
        }
    }

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
        bytes32 tokenData = _getTokenData(token);
        uint256 startWeight = tokenData.decodeUint(_START_DENORM_WEIGHT_OFFSET, 64).decompress(64, _MAX_DENORM_WEIGHT);
        uint256 endWeight = tokenData.decodeUint(_END_DENORM_WEIGHT_OFFSET, 64).decompress(64, _MAX_DENORM_WEIGHT);

        bytes32 poolState = _getMiscData();
        uint256 startTime = poolState.decodeUint(_WEIGHT_START_TIME_OFFSET, 32);
        uint256 endTime = poolState.decodeUint(_WEIGHT_END_TIME_OFFSET, 32);

        return
            _normalizeWeight(
                GradualValueChange.getInterpolatedValue(startWeight, endWeight, startTime, endTime),
                _denormWeightSum
            );
    }

    // This could be simplified by simply iteratively calling _getNormalizedWeight(), but this routine is
    // called very frequently, so we are optimizing for runtime performance.
    function _getNormalizedWeights() internal view override returns (uint256[] memory normalizedWeights) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        normalizedWeights = new uint256[](numTokens);

        bytes32 poolState = _getMiscData();
        uint256 startTime = poolState.decodeUint(_WEIGHT_START_TIME_OFFSET, 32);
        uint256 endTime = poolState.decodeUint(_WEIGHT_END_TIME_OFFSET, 32);

        uint256 denormWeightSum = _denormWeightSum;
        for (uint256 i = 0; i < numTokens; i++) {
            bytes32 tokenData = _tokenState[tokens[i]];
            uint256 startWeight = tokenData.decodeUint(_START_DENORM_WEIGHT_OFFSET, 64).decompress(
                64,
                _MAX_DENORM_WEIGHT
            );
            uint256 endWeight = tokenData.decodeUint(_END_DENORM_WEIGHT_OFFSET, 64).decompress(64, _MAX_DENORM_WEIGHT);

            normalizedWeights[i] = _normalizeWeight(
                GradualValueChange.getInterpolatedValue(startWeight, endWeight, startTime, endTime),
                denormWeightSum
            );
        }
    }

    // Swap overrides - revert unless swaps are enabled

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal virtual override returns (uint256) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        (uint256[] memory normalizedWeights, uint256[] memory preSwapBalances) = _getWeightsAndPreSwapBalances(
            swapRequest,
            currentBalanceTokenIn,
            currentBalanceTokenOut
        );

        // balances (and swapRequest.amount) are already upscaled by BaseMinimalSwapInfoPool.onSwap
        uint256 amountOut = super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);

        uint256[] memory postSwapBalances = ArrayHelpers.arrayFill(
            currentBalanceTokenIn.add(_addSwapFeeAmount(swapRequest.amount)),
            currentBalanceTokenOut.sub(amountOut)
        );

        _payProtocolAndManagementFees(normalizedWeights, preSwapBalances, postSwapBalances);

        return amountOut;
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal virtual override returns (uint256) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        (uint256[] memory normalizedWeights, uint256[] memory preSwapBalances) = _getWeightsAndPreSwapBalances(
            swapRequest,
            currentBalanceTokenIn,
            currentBalanceTokenOut
        );

        // balances (and swapRequest.amount) are already upscaled by BaseMinimalSwapInfoPool.onSwap
        uint256 amountIn = super._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);

        uint256[] memory postSwapBalances = ArrayHelpers.arrayFill(
            currentBalanceTokenIn.add(_addSwapFeeAmount(amountIn)),
            currentBalanceTokenOut.sub(swapRequest.amount)
        );

        _payProtocolAndManagementFees(normalizedWeights, preSwapBalances, postSwapBalances);

        return amountIn;
    }

    function _getWeightsAndPreSwapBalances(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) private view returns (uint256[] memory, uint256[] memory) {
        uint256[] memory normalizedWeights = ArrayHelpers.arrayFill(
            _getNormalizedWeight(swapRequest.tokenIn),
            _getNormalizedWeight(swapRequest.tokenOut)
        );

        uint256[] memory preSwapBalances = ArrayHelpers.arrayFill(currentBalanceTokenIn, currentBalanceTokenOut);

        return (normalizedWeights, preSwapBalances);
    }

    function _payProtocolAndManagementFees(
        uint256[] memory normalizedWeights,
        uint256[] memory preSwapBalances,
        uint256[] memory postSwapBalances
    ) private {
        // Calculate total BPT for the protocol and management fee
        // The management fee percentage applies to the remainder,
        // after the protocol fee has been collected.
        // So totalFee = protocolFee + (1 - protocolFee) * managementFee
        uint256 protocolSwapFeePercentage = getProtocolSwapFeePercentageCache();
        uint256 managementSwapFeePercentage = _managementSwapFeePercentage;

        if (protocolSwapFeePercentage == 0 && managementSwapFeePercentage == 0) {
            return;
        }

        // Fees are bounded, so we don't need checked math
        uint256 totalFeePercentage = protocolSwapFeePercentage +
            (FixedPoint.ONE - protocolSwapFeePercentage).mulDown(managementSwapFeePercentage);

        // No other balances are changing, so the other terms in the invariant will cancel out
        // when computing the ratio. So this partial invariant calculation is sufficient
        uint256 totalBptAmount = WeightedMath._calcDueProtocolSwapFeeBptAmount(
            totalSupply(),
            WeightedMath._calculateInvariant(normalizedWeights, preSwapBalances),
            WeightedMath._calculateInvariant(normalizedWeights, postSwapBalances),
            totalFeePercentage
        );

        // Calculate the portion of the total fee due the protocol
        // If the protocol fee were 30% and the manager fee 10%, the protocol would take 30% first.
        // Then the manager would take 10% of the remaining 70% (that is, 7%), for a total fee of 37%
        // The protocol would then earn 0.3/0.37 ~=81% of the total fee,
        // and the manager would get 0.1/0.75 ~=13%.
        uint256 protocolBptAmount = totalBptAmount.mulUp(protocolSwapFeePercentage.divUp(totalFeePercentage));

        if (protocolBptAmount > 0) {
            _payProtocolFees(protocolBptAmount);
        }

        // Pay the remainder in management fees
        // This goes to the controller, which needs to be able to withdraw them
        if (managementSwapFeePercentage > 0) {
            _mintPoolTokens(getOwner(), totalBptAmount.sub(protocolBptAmount));
        }
    }

    // Join/Exit overrides

    function _doJoin(
        address sender,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        // If swaps are disabled, only proportional joins are allowed. All others involve implicit swaps, and alter
        // token prices.
        // Adding tokens is also allowed, as that action can only be performed by the manager, who is assumed to
        // perform sensible checks.
        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(
            getSwapEnabled() ||
                kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT ||
                kind == WeightedPoolUserData.JoinKind.ADD_TOKEN,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        if (kind == WeightedPoolUserData.JoinKind.ADD_TOKEN) {
            return _doJoinAddToken(sender, scalingFactors, userData);
        } else {
            // Check allowlist for LPs, if applicable
            _require(isAllowedAddress(sender), Errors.ADDRESS_NOT_ALLOWLISTED);

            return super._doJoin(sender, balances, normalizedWeights, scalingFactors, userData);
        }
    }

    function _doJoinAddToken(
        address sender,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        // This join function can only be called by the Pool itself - the authorization logic that governs when that
        // call can be made resides in addToken.
        _require(sender == address(this), Errors.UNAUTHORIZED_JOIN);

        // No BPT will be issued for the join operation itself.
        // The `addToken` function mints a user specified `mintAmount` of BPT atomically with this call.
        uint256 bptAmountOut = 0;

        uint256 tokenIndex = scalingFactors.length - 1;
        uint256 amountIn = userData.addToken();

        // amountIn is unscaled so we need to upscale it using the token's scale factor.
        uint256[] memory amountsIn = new uint256[](scalingFactors.length);
        amountsIn[tokenIndex] = _upscale(amountIn, scalingFactors[tokenIndex]);

        return (bptAmountOut, amountsIn);
    }

    function _doExit(
        address sender,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
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

        return
            kind == WeightedPoolUserData.ExitKind.REMOVE_TOKEN
                ? _doExitRemoveToken(sender, balances, userData)
                : super._doExit(sender, balances, normalizedWeights, scalingFactors, userData);
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

    function _tokenAddressToIndex(IERC20[] memory tokens, IERC20 token) internal pure returns (uint256) {
        uint256 tokensLength = tokens.length;
        for (uint256 i = 0; i < tokensLength; i++) {
            if (tokens[i] == token) {
                return i;
            }
        }

        _revert(Errors.INVALID_TOKEN);
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
    ) internal virtual {
        uint256 normalizedSum;

        uint256 denormWeightSum = _denormWeightSum;
        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);
            normalizedSum = normalizedSum.add(endWeight);

            IERC20 token = tokens[i];
            _tokenState[token] = _encodeTokenState(token, startWeights[i], endWeight, denormWeightSum);
        }

        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _setMiscData(
            _getMiscData().insertUint(startTime, _WEIGHT_START_TIME_OFFSET, 32).insertUint(
                endTime,
                _WEIGHT_END_TIME_OFFSET,
                32
            )
        );

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    function _startGradualSwapFeeChange(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) internal virtual {
        if (startSwapFeePercentage != getSwapFeePercentage()) {
            super._setSwapFeePercentage(startSwapFeePercentage);
        }

        _setSwapFeeData(startTime, endTime, endSwapFeePercentage);

        emit GradualSwapFeeUpdateScheduled(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
    }

    function _setSwapFeeData(
        uint256 startTime,
        uint256 endTime,
        uint256 endSwapFeePercentage
    ) private {
        _setMiscData(
            _getMiscData()
                .insertUint(startTime, _FEE_START_TIME_OFFSET, 32)
                .insertUint(endTime, _FEE_END_TIME_OFFSET, 32)
                .insertUint(endSwapFeePercentage, _END_SWAP_FEE_PERCENTAGE_OFFSET, 62)
        );
    }

    // Factored out to avoid stack issues
    function _encodeTokenState(
        IERC20 token,
        uint256 normalizedStartWeight,
        uint256 normalizedEndWeight,
        uint256 denormWeightSum
    ) private view returns (bytes32) {
        bytes32 tokenState;

        // Tokens with more than 18 decimals are not supported
        // Scaling calculations must be exact/lossless
        // Store decimal difference instead of actual scaling factor
        return
            tokenState
                .insertUint(_encodeWeight(normalizedStartWeight, denormWeightSum), _START_DENORM_WEIGHT_OFFSET, 64)
                .insertUint(_encodeWeight(normalizedEndWeight, denormWeightSum), _END_DENORM_WEIGHT_OFFSET, 64)
                .insertUint(uint256(18).sub(ERC20(address(token)).decimals()), _DECIMAL_DIFF_OFFSET, 5);
    }

    // Broken out because the stack was too deep
    function _encodeWeight(uint256 weight, uint256 sum) private pure returns (uint256) {
        return _denormalizeWeight(weight, sum).compress(64, _MAX_DENORM_WEIGHT);
    }

    // Convert a decimal difference value to the scaling factor
    function _readScalingFactor(bytes32 tokenState) private pure returns (uint256) {
        uint256 decimalsDifference = tokenState.decodeUint(_DECIMAL_DIFF_OFFSET, 5);

        return FixedPoint.ONE * 10**decimalsDifference;
    }

    /**
     * @dev Extend ownerOnly functions to include the Managed Pool control functions.
     */
    function _isOwnerOnlyAction(bytes32 actionId)
        internal
        view
        override(
            // The ProtocolFeeCache module creates a small diamond that requires explicitly listing the parents here
            BasePool,
            BasePoolAuthorization
        )
        returns (bool)
    {
        return
            (actionId == getActionId(ManagedPool.updateWeightsGradually.selector)) ||
            (actionId == getActionId(ManagedPool.updateSwapFeeGradually.selector)) ||
            (actionId == getActionId(ManagedPool.setSwapEnabled.selector)) ||
            (actionId == getActionId(ManagedPool.addAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPool.removeAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPool.setMustAllowlistLPs.selector)) ||
            (actionId == getActionId(ManagedPool.addToken.selector)) ||
            (actionId == getActionId(ManagedPool.removeToken.selector)) ||
            (actionId == getActionId(ManagedPool.setManagementSwapFeePercentage.selector)) ||
            (actionId == getActionId(ManagedPool.setManagementAumFeePercentage.selector)) ||
            super._isOwnerOnlyAction(actionId);
    }

    function _getMaxSwapFeePercentage() internal pure virtual override returns (uint256) {
        return _MAX_SWAP_FEE_PERCENTAGE;
    }

    function _getTokenData(IERC20 token) private view returns (bytes32 tokenData) {
        tokenData = _tokenState[token];

        // A valid token can't be zero (must have non-zero weights)
        _require(tokenData != 0, Errors.INVALID_TOKEN);
    }

    // Join/exit callbacks

    function _beforeJoinExit(
        uint256[] memory,
        uint256[] memory,
        uint256
    ) internal virtual override {
        // The AUM fee calculation is based on inflating the Pool's BPT supply by a target rate.
        // We then must collect AUM fees whenever joining or exiting the pool to ensure that LPs only pay AUM fees
        // for the period during which they are an LP within the pool: otherwise an LP could shift their share of the
        // AUM fees onto the remaining LPs in the pool by exiting before they were paid.
        _collectAumManagementFees();
    }

    /**
     * @dev Calculates the AUM fees accrued since the last collection and pays it to the pool manager.
     * This function is called automatically on joins and exits.
     */
    function _collectAumManagementFees() internal returns (uint256 bptAmount) {
        uint256 lastCollection = _lastAumFeeCollectionTimestamp;
        uint256 currentTime = block.timestamp;

        // Collect fees based on the time elapsed
        if (currentTime > lastCollection) {
            // Reset the collection timer to the current block
            _lastAumFeeCollectionTimestamp = currentTime;

            uint256 managementAumFeePercentage = getManagementAumFeePercentage();

            // If `lastCollection` has not been set then we don't know what period over which to collect fees.
            // We then perform an early return after initializing it so that we can collect fees next time. This
            // means that AUM fees are not collected for any tokens the Pool is initialized with until the first
            // non-initialization join or exit.
            // We also perform an early return if the AUM fee is zero, to save gas.
            //
            // If the Pool has been paused, all fee calculation and minting is skipped to reduce execution
            // complexity to a minimum (and therefore the likelihood of errors). We do still update the last
            // collection timestamp however, to avoid potentially collecting extra fees if the Pool were to
            // be unpaused later. Any fees that would have been collected while the Pool was paused are lost.
            if (managementAumFeePercentage == 0 || lastCollection == 0 || !_isNotPaused()) {
                return 0;
            }

            // We want to collect fees so that the manager will receive `f` percent of the Pool's AUM after a year.
            // We compute the amount of BPT to mint for the manager that would allow it to proportionally exit the Pool
            // and receive this fraction of the Pool's assets.
            // Note that the total BPT supply will increase when minting, so we need to account for this
            // in order to compute the percentage of Pool ownership the manager will have.

            // The formula can be derived from:
            //
            // f = toMint / (supply + toMint)
            //
            // which can be rearranged into:
            //
            // toMint = supply * f / (1 - f)
            uint256 annualizedFee = totalSupply().mulDown(managementAumFeePercentage).divDown(
                managementAumFeePercentage.complement()
            );

            // This value is annualized: in normal operation we will collect fees regularly over the course of the year.
            // We then multiply this value by the fraction of the year which has elapsed since we last collected fees.
            uint256 elapsedTime = currentTime - lastCollection;
            uint256 fractionalTimePeriod = elapsedTime.divDown(365 days);
            bptAmount = annualizedFee.mulDown(fractionalTimePeriod);

            // Compute the protocol's share of the AUM fee
            uint256 protocolBptAmount = bptAmount.mulUp(getProtocolAumFeePercentageCache());
            uint256 managerBPTAmount = bptAmount.sub(protocolBptAmount);

            _payProtocolFees(protocolBptAmount);

            emit ManagementAumFeeCollected(managerBPTAmount);

            _mintPoolTokens(getOwner(), managerBPTAmount);
        }
    }

    // Functions that convert weights between internal (denormalized) and external (normalized) representations

    /**
     * @dev Converts a token weight from the internal representation (summing to denormWeightSum) to the normalized form
     */
    function _normalizeWeight(uint256 denormWeight, uint256 denormWeightSum) private pure returns (uint256) {
        return denormWeight.divDown(denormWeightSum);
    }

    /**
     * @dev Converts a token weight from normalized form to the internal representation (summing to denormWeightSum)
     */
    function _denormalizeWeight(uint256 weight, uint256 denormWeightSum) private pure returns (uint256) {
        return weight.mulUp(denormWeightSum);
    }
}
