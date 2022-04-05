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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableMap.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../BaseWeightedPool.sol";
import "../WeightedPoolUserData.sol";
import "./WeightCompression.sol";

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
 * token counts, rebalancing through token changes, gradual weight or fee updates, circuit breakers for
 * IL-protection, and more.
 */
contract ManagedPool is BaseWeightedPool, ReentrancyGuard {
    // ManagedPool weights can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WordCodec for bytes32;
    using WeightCompression for uint256;
    using WeightedPoolUserData for bytes;
    using EnumerableMap for EnumerableMap.IERC20ToUint256Map;

    // State variables

    // The upper bound is WeightedMath.MAX_WEIGHTED_TOKENS, but this is constrained by other factors, such as Pool
    // creation gas consumption.
    uint256 private constant _MAX_MANAGED_TOKENS = 50;

    uint256 private constant _MAX_MANAGEMENT_SWAP_FEE_PERCENTAGE = 1e18; // 100%

    // Use the _miscData slot in BasePool
    // First 64 bits are reserved for the swap fee
    //
    // Store non-token-based values:
    // Start/end timestamps for gradual weight update
    // Cache total tokens
    // [ 64 bits  | 119 bits |    1 bit    |  32 bits  |   32 bits  |    7 bits    |   1 bit   ]
    // [ reserved |  unused  | restrict LP | end time  | start time | total tokens | swap flag ]
    // |MSB                                                                                 LSB|
    uint256 private constant _SWAP_ENABLED_OFFSET = 0;
    uint256 private constant _TOTAL_TOKENS_OFFSET = 1;
    uint256 private constant _START_TIME_OFFSET = 8;
    uint256 private constant _END_TIME_OFFSET = 40;
    uint256 private constant _MUST_ALLOWLIST_LPS_OFFSET = 72;

    // 7 bits is enough for the token count, since _MAX_MANAGED_TOKENS is 50

    // Store scaling factor and start/end weights for each token
    // Mapping should be more efficient than trying to compress it further
    // [ 155 bits|   5 bits |  32 bits   |   64 bits    |
    // [ unused  | decimals | end weight | start weight |
    // |MSB                                          LSB|
    mapping(IERC20 => bytes32) private _tokenState;

    EnumerableMap.IERC20ToUint256Map private _tokenCollectedManagementFees;

    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 96;

    // If mustAllowlistLPs is enabled, this is the list of addresses allowed to join the pool
    mapping(address => bool) private _allowedAddresses;

    // Percentage of swap fees that are allocated to the Pool owner, after protocol fees
    uint256 private _managementSwapFeePercentage;

    // Event declarations

    event GradualWeightUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256[] startWeights,
        uint256[] endWeights
    );
    event SwapEnabledSet(bool swapEnabled);
    event MustAllowlistLPsSet(bool mustAllowlistLPs);
    event ManagementFeePercentageChanged(uint256 managementFeePercentage);
    event ManagementFeesCollected(IERC20[] tokens, uint256[] amounts);
    event AllowlistAddressAdded(address indexed member);
    event AllowlistAddressRemoved(address indexed member);

    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] normalizedWeights;
        address[] assetManagers;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address owner;
        bool swapEnabledOnStart;
        bool mustAllowlistLPs;
        uint256 managementSwapFeePercentage;
    }

    constructor(NewPoolParams memory params)
        BaseWeightedPool(
            params.vault,
            params.name,
            params.symbol,
            params.tokens,
            params.assetManagers,
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        uint256 totalTokens = params.tokens.length;
        InputHelpers.ensureInputLengthMatch(totalTokens, params.normalizedWeights.length, params.assetManagers.length);

        _setMiscData(_getMiscData().insertUint7(totalTokens, _TOTAL_TOKENS_OFFSET));

        // Double check it fits in 7 bits
        _require(_getTotalTokens() == totalTokens, Errors.MAX_TOKENS);

        // Validate and set initial fee
        _setManagementSwapFeePercentage(params.managementSwapFeePercentage);

        uint256 currentTime = block.timestamp;
        _startGradualWeightChange(
            currentTime,
            currentTime,
            params.normalizedWeights,
            params.normalizedWeights,
            params.tokens
        );

        // Initialize the accrued management fees map with the Pool's tokens and zero collected fees.
        for (uint256 i = 0; i < totalTokens; ++i) {
            _tokenCollectedManagementFees.set(params.tokens[i], 0);
        }

        // If false, the pool will start in the disabled state (prevents front-running the enable swaps transaction).
        _setSwapEnabled(params.swapEnabledOnStart);

        // If true, only addresses on the manager-controlled allowlist may join the pool.
        _setMustAllowlistLPs(params.mustAllowlistLPs);
    }

    /**
     * @dev Returns true if swaps are enabled.
     */
    function getSwapEnabled() public view returns (bool) {
        return _getMiscData().decodeBool(_SWAP_ENABLED_OFFSET);
    }

    /**
     * @dev Returns true if the allowlist for LPs is enabled.
     */
    function getMustAllowlistLPs() public view returns (bool) {
        return _getMiscData().decodeBool(_MUST_ALLOWLIST_LPS_OFFSET);
    }

    /**
     * @dev Verifies that a given address is allowed to hold tokens.
     */
    function isAllowedAddress(address member) public view returns (bool) {
        return !getMustAllowlistLPs() || _allowedAddresses[member];
    }

    /**
     * @dev Returns the management swap fee percentage as a 18-decimals fixed point number.
     */
    function getManagementSwapFeePercentage() public view returns (uint256) {
        return _managementSwapFeePercentage;
    }

    /**
     * @dev Return start time, end time, and endWeights as an array.
     * Current weights should be retrieved via `getNormalizedWeights()`.
     */
    function getGradualWeightUpdateParams()
        external
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory endWeights
        )
    {
        // Load current pool state from storage
        bytes32 poolState = _getMiscData();

        startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 totalTokens = tokens.length;

        endWeights = new uint256[](totalTokens);

        for (uint256 i = 0; i < totalTokens; i++) {
            endWeights[i] = _tokenState[tokens[i]].decodeUint32(_END_WEIGHT_OFFSET).uncompress32();
        }
    }

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return _MAX_MANAGED_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _getMiscData().decodeUint7(_TOTAL_TOKENS_OFFSET);
    }

    /**
     * @dev Schedule a gradual weight change, from the current weights to the given endWeights,
     * over startTime to endTime.
     */
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external authenticate whenNotPaused nonReentrant {
        InputHelpers.ensureInputLengthMatch(_getTotalTokens(), endWeights.length);

        // If the start time is in the past, "fast forward" to start now
        // This avoids discontinuities in the weight curve. Otherwise, if you set the start/end times with
        // only 10% of the period in the future, the weights would immediately jump 90%
        uint256 currentTime = block.timestamp;
        startTime = Math.max(currentTime, startTime);

        _require(startTime <= endTime, Errors.GRADUAL_UPDATE_TIME_TRAVEL);

        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());

        _startGradualWeightChange(startTime, endTime, _getNormalizedWeights(), endWeights, tokens);
    }

    function getCollectedManagementFees() public view returns (IERC20[] memory tokens, uint256[] memory collectedFees) {
        tokens = new IERC20[](_getTotalTokens());
        collectedFees = new uint256[](_getTotalTokens());

        for (uint256 i = 0; i < _getTotalTokens(); ++i) {
            // We can use unchecked getters as we know the map has the same size (and order!) as the Pool's tokens.
            (IERC20 token, uint256 fees) = _tokenCollectedManagementFees.unchecked_at(i);
            tokens[i] = token;
            collectedFees[i] = fees;
        }

        _downscaleDownArray(collectedFees, _scalingFactors());
    }

    function withdrawCollectedManagementFees(address recipient) external authenticate whenNotPaused nonReentrant {
        (IERC20[] memory tokens, uint256[] memory collectedFees) = getCollectedManagementFees();

        getVault().exitPool(
            getPoolId(),
            address(this),
            payable(recipient),
            IVault.ExitPoolRequest({
                assets: _asIAsset(tokens),
                minAmountsOut: collectedFees,
                userData: abi.encode(WeightedPoolUserData.ExitKind.MANAGEMENT_FEE_TOKENS_OUT),
                toInternalBalance: false
            })
        );

        // Technically collectedFees is the minimum amount, not the actual amount. However, since no fees will be
        // collected during the exit, it will also be the actual amount.
        emit ManagementFeesCollected(tokens, collectedFees);
    }

    /**
     * @dev Adds an address to the allowlist.
     */
    function addAllowedAddress(address member) external authenticate whenNotPaused {
        _require(getMustAllowlistLPs(), Errors.UNAUTHORIZED_OPERATION);
        _require(!_allowedAddresses[member], Errors.ADDRESS_ALREADY_ALLOWLISTED);

        _allowedAddresses[member] = true;
        emit AllowlistAddressAdded(member);
    }

    /**
     * @dev Removes an address from the allowlist.
     */
    function removeAllowedAddress(address member) external authenticate whenNotPaused {
        _require(_allowedAddresses[member], Errors.ADDRESS_NOT_ALLOWLISTED);

        delete _allowedAddresses[member];
        emit AllowlistAddressRemoved(member);
    }

    /**
     * @dev Can enable/disable the LP allowlist. Note that any addresses added to the allowlist
     * will be retained if the allowlist is toggled off and back on again.
     */
    function setMustAllowlistLPs(bool mustAllowlistLPs) external authenticate whenNotPaused {
        _setMustAllowlistLPs(mustAllowlistLPs);
    }

    function _setMustAllowlistLPs(bool mustAllowlistLPs) private {
        _setMiscData(_getMiscData().insertBool(mustAllowlistLPs, _MUST_ALLOWLIST_LPS_OFFSET));

        emit MustAllowlistLPsSet(mustAllowlistLPs);
    }

    /**
     * @dev Enable/disable trading
     */
    function setSwapEnabled(bool swapEnabled) external authenticate whenNotPaused {
        _setSwapEnabled(swapEnabled);
    }

    function _setSwapEnabled(bool swapEnabled) private {
        _setMiscData(_getMiscData().insertBool(swapEnabled, _SWAP_ENABLED_OFFSET));

        emit SwapEnabledSet(swapEnabled);
    }

    /**
     * @dev Set the management fee percentage
     */
    function setManagementSwapFeePercentage(uint256 managementFeePercentage) external authenticate whenNotPaused {
        _setManagementSwapFeePercentage(managementFeePercentage);
    }

    function _setManagementSwapFeePercentage(uint256 managementSwapFeePercentage) private {
        _require(
            managementSwapFeePercentage <= _MAX_MANAGEMENT_SWAP_FEE_PERCENTAGE,
            Errors.MAX_MANAGEMENT_SWAP_FEE_PERCENTAGE
        );

        _managementSwapFeePercentage = managementSwapFeePercentage;
        emit ManagementFeePercentageChanged(managementSwapFeePercentage);
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
        uint256 pctProgress = _calculateWeightChangeProgress();
        bytes32 tokenData = _getTokenData(token);

        return _interpolateWeight(tokenData, pctProgress);
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory normalizedWeights) {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256 numTokens = tokens.length;

        normalizedWeights = new uint256[](numTokens);

        uint256 pctProgress = _calculateWeightChangeProgress();

        for (uint256 i = 0; i < numTokens; i++) {
            bytes32 tokenData = _tokenState[tokens[i]];

            normalizedWeights[i] = _interpolateWeight(tokenData, pctProgress);
        }
    }

    function _getNormalizedWeightsAndMaxWeightIndex()
        internal
        view
        override
        returns (uint256[] memory normalizedWeights, uint256 maxWeightTokenIndex)
    {
        normalizedWeights = _getNormalizedWeights();

        maxWeightTokenIndex = 0;
        uint256 maxNormalizedWeight = normalizedWeights[0];

        for (uint256 i = 1; i < normalizedWeights.length; i++) {
            if (normalizedWeights[i] > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeights[i];
            }
        }
    }

    // Swap overrides - revert unless swaps are enabled

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal override returns (uint256) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        return super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal override returns (uint256) {
        _require(getSwapEnabled(), Errors.SWAPS_DISABLED);

        return super._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    /**
     * @dev Used to adjust balances by subtracting all collected fees from them, as if they had been withdrawn from the
     * Vault.
     */
    function _subtractCollectedFees(uint256[] memory balances) private view {
        for (uint256 i = 0; i < _getTotalTokens(); ++i) {
            // We can use unchecked getters as we know the map has the same size (and order!) as the Pool's tokens.
            balances[i] = balances[i].sub(_tokenCollectedManagementFees.unchecked_valueAt(i));
        }
    }

    // We override _onJoinPool and _onExitPool as we need to not compute the current invariant and calculate protocol
    // fees, since that mechanism does not work for Pools in which the weights change over time. Instead, this Pool
    // always pays zero protocol fees.
    // Additionally, we also check that only non-swap join and exit kinds are allowed while swaps are disabled.

    function getLastInvariant() public pure override returns (uint256) {
        _revert(Errors.UNHANDLED_BY_MANAGED_POOL);
    }

    function _onJoinPool(
        bytes32,
        address sender,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        whenNotPaused // All joins are disabled while the contract is paused.
        returns (
            uint256 bptAmountOut,
            uint256[] memory amountsIn,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        // If swaps are disabled, the only join kind that is allowed is the proportional one, as all others involve
        // implicit swaps and alter token prices.
        _require(
            getSwapEnabled() || userData.joinKind() == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );
        // Check allowlist for LPs, if applicable
        _require(isAllowedAddress(sender), Errors.ADDRESS_NOT_ALLOWLISTED);

        _subtractCollectedFees(balances);

        (bptAmountOut, amountsIn) = _doJoin(balances, _getNormalizedWeights(), scalingFactors, userData);
        dueProtocolFeeAmounts = new uint256[](_getTotalTokens());
    }

    function _onExitPool(
        bytes32,
        address sender,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
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

        // If swaps are disabled, the only exit kind that is allowed is the proportional one (as all others involve
        // implicit swaps and alter token prices) and management fee collection (as there's no point in restricting
        // that).
        WeightedPoolUserData.ExitKind kind = userData.exitKind();
        _require(
            getSwapEnabled() ||
                kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT ||
                kind == WeightedPoolUserData.ExitKind.MANAGEMENT_FEE_TOKENS_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        _subtractCollectedFees(balances);

        (bptAmountIn, amountsOut) = _doManagedPoolExit(
            sender,
            balances,
            _getNormalizedWeights(),
            scalingFactors,
            userData
        );
        dueProtocolFeeAmounts = new uint256[](_getTotalTokens());
    }

    function _doManagedPoolExit(
        address sender,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal returns (uint256, uint256[] memory) {
        WeightedPoolUserData.ExitKind kind = userData.exitKind();

        if (kind == WeightedPoolUserData.ExitKind.MANAGEMENT_FEE_TOKENS_OUT) {
            return _exitManagerFeeTokensOut(sender);
        } else {
            return _doExit(balances, normalizedWeights, scalingFactors, userData);
        }
    }

    function _exitManagerFeeTokensOut(address sender)
        private
        whenNotPaused
        returns (uint256 bptAmountIn, uint256[] memory amountsOut)
    {
        // This exit function is disabled if the contract is paused.

        // This exit function can only be called by the Pool itself - the authorization logic that governs when that
        // call can be made resides in withdrawCollectedManagementFees.
        _require(sender == address(this), Errors.UNAUTHORIZED_EXIT);

        // Since what we're doing is sending out collected management fees, we don't require any BPT in exchange: we
        // simply send those funds over.
        bptAmountIn = 0;

        amountsOut = new uint256[](_getTotalTokens());
        for (uint256 i = 0; i < _getTotalTokens(); ++i) {
            // We can use unchecked getters and setters as we know the map has the same size (and order!) as the Pool's
            // tokens.
            amountsOut[i] = _tokenCollectedManagementFees.unchecked_valueAt(i);
            _tokenCollectedManagementFees.unchecked_setAt(i, 0);
        }
    }

    function _tokenAddressToIndex(IERC20 token) internal view override returns (uint256) {
        return _tokenCollectedManagementFees.indexOf(token, Errors.INVALID_TOKEN);
    }

    function _processSwapFeeAmount(uint256 index, uint256 amount) internal virtual override {
        if (amount > 0) {
            uint256 managementFeeAmount = amount.mulDown(_managementSwapFeePercentage);

            uint256 previousCollectedFees = _tokenCollectedManagementFees.unchecked_valueAt(index);
            _tokenCollectedManagementFees.unchecked_setAt(index, previousCollectedFees.add(managementFeeAmount));
        }

        super._processSwapFeeAmount(index, amount);
    }

    // Pool swap hook override - subtract collected fees from all token amounts. We do this here as the original
    // `onSwap` does quite a bit of work, including computing swap fees, so we need to intercept that.

    function onSwap(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) public override returns (uint256) {
        uint256 tokenInUpscaledCollectedFees = _tokenCollectedManagementFees.get(
            swapRequest.tokenIn,
            Errors.INVALID_TOKEN
        );
        uint256 adjustedBalanceTokenIn = currentBalanceTokenIn.sub(
            _downscaleDown(tokenInUpscaledCollectedFees, _scalingFactor(swapRequest.tokenIn))
        );

        uint256 tokenOutUpscaledCollectedFees = _tokenCollectedManagementFees.get(
            swapRequest.tokenOut,
            Errors.INVALID_TOKEN
        );
        uint256 adjustedBalanceTokenOut = currentBalanceTokenOut.sub(
            _downscaleDown(tokenOutUpscaledCollectedFees, _scalingFactor(swapRequest.tokenOut))
        );

        return super.onSwap(swapRequest, adjustedBalanceTokenIn, adjustedBalanceTokenOut);
    }

    /**
     * @dev When calling updateWeightsGradually again during an update, reset the start weights to the current weights,
     * if necessary. Time travel elements commented out.
     */
    function _startGradualWeightChange(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory startWeights,
        uint256[] memory endWeights,
        IERC20[] memory tokens
    ) internal virtual {
        uint256 normalizedSum = 0;
        bytes32 tokenState;

        for (uint256 i = 0; i < endWeights.length; i++) {
            uint256 endWeight = endWeights[i];
            _require(endWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);

            IERC20 token = tokens[i];

            // Tokens with more than 18 decimals are not supported
            // Scaling calculations must be exact/lossless
            // Store decimal difference instead of actual scaling factor
            _tokenState[token] = tokenState
                .insertUint64(startWeights[i].compress64(), _START_WEIGHT_OFFSET)
                .insertUint32(endWeight.compress32(), _END_WEIGHT_OFFSET)
                .insertUint5(uint256(18).sub(ERC20(address(token)).decimals()), _DECIMAL_DIFF_OFFSET);

            normalizedSum = normalizedSum.add(endWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _setMiscData(
            _getMiscData().insertUint32(startTime, _START_TIME_OFFSET).insertUint32(endTime, _END_TIME_OFFSET)
        );

        emit GradualWeightUpdateScheduled(startTime, endTime, startWeights, endWeights);
    }

    function _readScalingFactor(bytes32 tokenState) private pure returns (uint256) {
        uint256 decimalsDifference = tokenState.decodeUint5(_DECIMAL_DIFF_OFFSET);

        return FixedPoint.ONE * 10**decimalsDifference;
    }

    /**
     * @dev Extend ownerOnly functions to include the Managed Pool control functions.
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view override returns (bool) {
        return
            (actionId == getActionId(ManagedPool.updateWeightsGradually.selector)) ||
            (actionId == getActionId(ManagedPool.setSwapEnabled.selector)) ||
            (actionId == getActionId(ManagedPool.withdrawCollectedManagementFees.selector)) ||
            (actionId == getActionId(ManagedPool.addAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPool.removeAllowedAddress.selector)) ||
            (actionId == getActionId(ManagedPool.setMustAllowlistLPs.selector)) ||
            (actionId == getActionId(ManagedPool.setManagementSwapFeePercentage.selector)) ||
            super._isOwnerOnlyAction(actionId);
    }

    /**
     * @dev Returns a fixed-point number representing how far along the current weight change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function _calculateWeightChangeProgress() private view returns (uint256) {
        uint256 currentTime = block.timestamp;
        bytes32 poolState = _getMiscData();

        uint256 startTime = poolState.decodeUint32(_START_TIME_OFFSET);
        uint256 endTime = poolState.decodeUint32(_END_TIME_OFFSET);

        if (currentTime >= endTime) {
            return FixedPoint.ONE;
        } else if (currentTime <= startTime) {
            return 0;
        }

        uint256 totalSeconds = endTime - startTime;
        uint256 secondsElapsed = currentTime - startTime;

        // In the degenerate case of a zero duration change, consider it completed (and avoid division by zero)
        return secondsElapsed.divDown(totalSeconds);
    }

    function _interpolateWeight(bytes32 tokenData, uint256 pctProgress) private pure returns (uint256 finalWeight) {
        uint256 startWeight = tokenData.decodeUint64(_START_WEIGHT_OFFSET).uncompress64();
        uint256 endWeight = tokenData.decodeUint32(_END_WEIGHT_OFFSET).uncompress32();

        if (pctProgress == 0 || startWeight == endWeight) return startWeight;
        if (pctProgress >= FixedPoint.ONE) return endWeight;

        if (startWeight > endWeight) {
            uint256 weightDelta = pctProgress.mulDown(startWeight - endWeight);
            return startWeight - weightDelta;
        } else {
            uint256 weightDelta = pctProgress.mulDown(endWeight - startWeight);
            return startWeight + weightDelta;
        }
    }

    function _getTokenData(IERC20 token) private view returns (bytes32 tokenData) {
        tokenData = _tokenState[token];

        // A valid token can't be zero (must have non-zero weights)
        _require(tokenData != 0, Errors.INVALID_TOKEN);
    }
}
