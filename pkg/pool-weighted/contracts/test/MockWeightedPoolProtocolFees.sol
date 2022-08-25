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

import "../WeightedPoolProtocolFees.sol";

contract MockWeightedPoolProtocolFees is WeightedPoolProtocolFees {
    constructor(
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        bool mutableTokens
    )
        BaseWeightedPool(
            vault,
            name,
            symbol,
            tokens,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
            mutableTokens
        )
        ProtocolFeeCache(protocolFeeProvider, ProtocolFeeCache.DELEGATE_PROTOCOL_SWAP_FEES_SENTINEL)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function beforeJoinExit(uint256[] memory preBalances, uint256[] memory normalizedWeights) external {
        uint256 protocolFeesToBeMinted = _getSwapProtocolFees(preBalances, normalizedWeights, totalSupply());

        if (protocolFeesToBeMinted > 0) {
            _payProtocolFees(protocolFeesToBeMinted);
        }
    }

    function afterJoinExit(
        uint256[] memory preBalances,
        uint256[] memory balanceDeltas,
        uint256[] memory normalizedWeights,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) external {
        (uint256 protocolFeesToBeMinted, uint256 postJoinExitInvariant) = _getJoinExitProtocolFees(
            preBalances,
            balanceDeltas,
            normalizedWeights,
            preJoinExitSupply,
            postJoinExitSupply
        );

        if (protocolFeesToBeMinted > 0) {
            _payProtocolFees(protocolFeesToBeMinted);
        }

        _updatePostJoinExit(postJoinExitInvariant);
    }

    function getSwapProtocolFees(
        uint256[] memory preBalances,
        uint256[] memory normalizedWeights,
        uint256 preJoinExitSupply
    ) external view returns (uint256) {
        return _getSwapProtocolFees(preBalances, normalizedWeights, preJoinExitSupply);
    }

    function getJoinExitProtocolFees(
        uint256[] memory preBalances,
        uint256[] memory balanceDeltas,
        uint256[] memory normalizedWeights,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) external view returns (uint256, uint256) {
        return
            _getJoinExitProtocolFees(
                preBalances,
                balanceDeltas,
                normalizedWeights,
                preJoinExitSupply,
                postJoinExitSupply
            );
    }

    function updatePostJoinExit(uint256 postJoinExitInvariant) external {
        _updatePostJoinExit(postJoinExitInvariant);
    }

    // Stubbed functions

    function _getMaxTokens() internal pure override returns (uint256) {
        return 8;
    }

    function _getNormalizedWeight(IERC20) internal pure override returns (uint256) {
        revert("NOT_IMPLEMENTED");
    }

    function _getNormalizedWeights() internal pure override returns (uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function _getTotalTokens() internal pure override returns (uint256) {
        revert("NOT_IMPLEMENTED");
    }

    function _scalingFactor(IERC20) internal pure override returns (uint256) {
        revert("NOT_IMPLEMENTED");
    }

    function _scalingFactors() internal pure override returns (uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }
}
