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

import "../ComposableStablePoolStorage.sol";

contract MockComposableStablePoolStorage is ComposableStablePoolStorage {
    constructor(
        IVault vault,
        IERC20[] memory tokens,
        IRateProvider[] memory tokenRateProviders,
        bool[] memory exemptFromYieldProtocolFeeFlags
    )
        ComposableStablePoolStorage(
            StorageParams({
                registeredTokens: _insertSorted(tokens, IERC20(this)),
                tokenRateProviders: tokenRateProviders,
                exemptFromYieldProtocolFeeFlags: exemptFromYieldProtocolFeeFlags
            })
        )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            "MockComposableStablePoolStorage",
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

    function getRateProvider0() external view returns (IRateProvider) {
        return _rateProvider0;
    }

    function getRateProvider1() external view returns (IRateProvider) {
        return _rateProvider1;
    }

    function getRateProvider2() external view returns (IRateProvider) {
        return _rateProvider2;
    }

    function getRateProvider3() external view returns (IRateProvider) {
        return _rateProvider3;
    }

    function getRateProvider4() external view returns (IRateProvider) {
        return _rateProvider4;
    }

    function getRateProvider5() external view returns (IRateProvider) {
        return _rateProvider5;
    }

    function getScalingFactor0() external view returns (uint256) {
        return _scalingFactor0;
    }

    function getScalingFactor1() external view returns (uint256) {
        return _scalingFactor1;
    }

    function getScalingFactor2() external view returns (uint256) {
        return _scalingFactor2;
    }

    function getScalingFactor3() external view returns (uint256) {
        return _scalingFactor3;
    }

    function getScalingFactor4() external view returns (uint256) {
        return _scalingFactor4;
    }

    function getScalingFactor5() external view returns (uint256) {
        return _scalingFactor5;
    }

    function getRateProvider(uint256 index) external view returns (IRateProvider) {
        return _getRateProvider(index);
    }

    // This assumes the tokenIndex is valid. If it's not, it will just return false.
    function isTokenExemptFromYieldProtocolFeeByIndex(uint256 tokenIndex) external view returns (bool) {
        return _isTokenExemptFromYieldProtocolFee(tokenIndex);
    }

    function areAllTokensExempt() external view returns (bool) {
        return _areAllTokensExempt();
    }

    function areNoTokensExempt() external view returns (bool) {
        return _areNoTokensExempt();
    }

    // Stubbed functions

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {}

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

    function _doRecoveryModeExit(
        uint256[] memory,
        uint256,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }
}
