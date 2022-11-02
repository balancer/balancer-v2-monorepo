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
    uint256 private immutable _totalTokens;

    constructor(
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        IRateProvider[] memory rateProviders,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
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
            false
        )
        ProtocolFeeCache(
            protocolFeeProvider,
            ProviderFeeIDs({ swap: ProtocolFeeType.SWAP, yield: ProtocolFeeType.YIELD, aum: ProtocolFeeType.AUM })
        )
        WeightedPoolProtocolFees(tokens.length, rateProviders)
    {
        _totalTokens = tokens.length;
    }

    function getYieldFeeExemption(IRateProvider[] memory rateProviders) external pure returns (bool) {
        return _getYieldFeeExemption(rateProviders);
    }

    function getRateProduct(uint256[] memory normalizedWeights) external view returns (uint256) {
        return _getRateProduct(normalizedWeights);
    }

    function updateATHRateProduct(uint256 rateProduct) external {
        _updateATHRateProduct(rateProduct);
    }

    function getYieldProtocolFee(uint256[] memory normalizedWeights, uint256 supply)
        external
        view
        returns (uint256 yieldProtocolFees, uint256 athRateProduct)
    {
        uint256 protocolYieldFeesPoolPercentage;
        (protocolYieldFeesPoolPercentage, athRateProduct) = _getYieldProtocolFeesPoolPercentage(normalizedWeights);
        yieldProtocolFees = ExternalFees.bptForPoolOwnershipPercentage(supply, protocolYieldFeesPoolPercentage);
    }

    function getPostJoinExitProtocolFees(
        uint256[] memory preBalances,
        uint256[] memory balanceDeltas,
        uint256[] memory normalizedWeights,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) external returns (uint256) {
        return
            _getPostJoinExitProtocolFees(
                WeightedMath._calculateInvariant(normalizedWeights, preBalances),
                preBalances,
                balanceDeltas,
                normalizedWeights,
                preJoinExitSupply,
                postJoinExitSupply
            );
    }

    // Stubbed functions

    function _getMaxTokens() internal pure override returns (uint256) {
        return 8;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
    }

    function _getNormalizedWeight(IERC20) internal pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _getNormalizedWeights() internal pure override returns (uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _scalingFactor(IERC20) internal pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _scalingFactors() internal pure override returns (uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
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
        _revert(Errors.UNIMPLEMENTED);
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
        _revert(Errors.UNIMPLEMENTED);
    }
}
