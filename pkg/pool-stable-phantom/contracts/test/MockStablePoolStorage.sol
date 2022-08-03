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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";

import "../StablePoolStorage.sol";

contract MockStablePoolStorage is StablePoolStorage {
    constructor(
        IVault vault,
        IERC20[] memory tokens,
        IRateProvider[] memory tokenRateProviders,
        bool[] memory exemptFromYieldProtocolFeeFlags
    )
        StablePoolStorage(
            StorageParams(_insertSorted(tokens, IERC20(this)), tokenRateProviders, exemptFromYieldProtocolFeeFlags)
        )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            "MockStablePoolStorage",
            "MOCK_BPT",
            _insertSorted(tokens, IERC20(this)),
            new address[](tokens.length + 1),
            1e12, // BasePool._MIN_SWAP_FEE_PERCENTAGE
            0,
            0,
            address(0)
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function skipBptIndex(uint256 index) external view returns (uint256) {
        return _skipBptIndex(index);
    }

    function addBptIndex(uint256 index) external view returns (uint256) {
        return _addBptIndex(index);
    }

    function dropBptItem(uint256[] memory amounts) external view returns (uint256[] memory) {
        return _dropBptItem(amounts);
    }

    function addBptItem(uint256[] memory amounts, uint256 bptAmount)
        external
        view
        returns (uint256[] memory amountsWithBpt)
    {
        return _addBptItem(amounts, bptAmount);
    }

    /**
     * @notice Return the scaling factor for a token. This includes both the token decimals and the rate.
     */
    function getScalingFactor(IERC20 token) external view returns (uint256) {
        return _scalingFactor(token);
    }

    // Computed the total scaling factor as a product of the token decimal adjustment and token rate.
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return _tokenScalingFactor(token);
    }

    function getToken0() external view returns (IERC20) {
        return _getToken0();
    }

    function getToken1() external view returns (IERC20) {
        return _getToken1();
    }

    function getToken2() external view returns (IERC20) {
        return _getToken2();
    }

    function getToken3() external view returns (IERC20) {
        return _getToken3();
    }

    function getToken4() external view returns (IERC20) {
        return _getToken4();
    }

    function getToken5() external view returns (IERC20) {
        return _getToken5();
    }

    function getRateProvider0() external view returns (IRateProvider) {
        return _getRateProvider0();
    }

    function getRateProvider1() external view returns (IRateProvider) {
        return _getRateProvider1();
    }

    function getRateProvider2() external view returns (IRateProvider) {
        return _getRateProvider2();
    }

    function getRateProvider3() external view returns (IRateProvider) {
        return _getRateProvider3();
    }

    function getRateProvider4() external view returns (IRateProvider) {
        return _getRateProvider4();
    }

    function getRateProvider5() external view returns (IRateProvider) {
        return _getRateProvider5();
    }

    function getScalingFactor0() external view returns (uint256) {
        return _getScalingFactor0();
    }

    function getScalingFactor1() external view returns (uint256) {
        return _getScalingFactor1();
    }

    function getScalingFactor2() external view returns (uint256) {
        return _getScalingFactor2();
    }

    function getScalingFactor3() external view returns (uint256) {
        return _getScalingFactor3();
    }

    function getScalingFactor4() external view returns (uint256) {
        return _getScalingFactor4();
    }

    function getScalingFactor5() external view returns (uint256) {
        return _getScalingFactor5();
    }

    /**
     * @dev Overrides scaling factor getter to compute the tokens' rates.
     */
    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        // There is no need to check the arrays length since both are based on `_getTotalTokens`
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory scalingFactors = new uint256[](totalTokens);

        // The Pool will always have at least 3 tokens so we always load these three scaling factors.
        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.
        scalingFactors[0] = _getScalingFactor0();
        scalingFactors[1] = _getScalingFactor1();
        scalingFactors[2] = _getScalingFactor2();

        // Before we load the remaining scaling factors we must check that the Pool contains enough tokens.
        if (totalTokens == 3) return scalingFactors;
        scalingFactors[3] = _getScalingFactor3();

        if (totalTokens == 4) return scalingFactors;
        scalingFactors[4] = _getScalingFactor4();

        if (totalTokens == 5) return scalingFactors;
        scalingFactors[5] = _getScalingFactor5();

        return scalingFactors;
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
