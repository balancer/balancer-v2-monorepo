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

import "../managed/ManagedPoolSettings.sol";

contract MockManagedPoolSettings is ManagedPoolSettings {
    using WeightedPoolUserData for bytes;

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
            PoolRegistrationLib.registerPoolWithAssetManagers(
                vault,
                IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
                params.tokens,
                params.assetManagers
            ),
            params.name,
            params.symbol,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
        ManagedPoolSettings(params, protocolFeeProvider)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function getVirtualSupply() external view returns (uint256) {
        return _getVirtualSupply();
    }

    function _onInitializePool(address, bytes memory userData) internal override returns (uint256, uint256[] memory) {
        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);

        (IERC20[] memory tokens, ) = _getPoolTokens();
        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, tokens.length);

        uint256[] memory scalingFactors = _scalingFactors(tokens);
        _upscaleArray(amountsIn, scalingFactors);

        uint256 invariantAfterJoin = WeightedMath._calculateInvariant(_getNormalizedWeights(tokens), amountsIn);

        // Set the initial BPT to the value of the invariant times the number of tokens. This makes BPT supply more
        // consistent in Pools with similar compositions but different number of tokens.
        uint256 bptAmountOut = Math.mul(invariantAfterJoin, amountsIn.length);

        // We want to start collecting AUM fees from this point onwards. Prior to initialization the Pool holds no funds
        // so naturally charges no AUM fees.
        _updateAumFeeCollectionTimestamp();

        // amountsIn are amounts entering the Pool, so we round up.
        _downscaleUpArray(amountsIn, scalingFactors);

        return (bptAmountOut, amountsIn);
    }

    function isOwnerOnlyAction(bytes32 actionId) external view returns (bool) {
        return _isOwnerOnlyAction(actionId);
    }

    function validateSwapFeePercentage(uint256 swapFeePercentage) external pure {
        _validateSwapFeePercentage(swapFeePercentage);
    }

    // Unimplemented

    function _onSwapMinimal(
        SwapRequest memory,
        uint256,
        uint256
    ) internal pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onJoinPool(
        address,
        uint256[] memory,
        bytes memory
    ) internal virtual override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onExitPool(
        address,
        uint256[] memory,
        bytes memory
    ) internal virtual override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onSwapGeneral(
        SwapRequest memory,
        uint256[] memory,
        uint256,
        uint256
    ) internal pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }
}
