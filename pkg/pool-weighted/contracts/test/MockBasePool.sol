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

import "../managed/vendor/BasePool.sol";

contract MockBasePool is BasePool {
    using WeightedPoolUserData for bytes;

    uint256 private immutable _totalTokens;

    bool private _inRecoveryMode;

    event InnerOnInitializePoolCalled(bytes userData);
    event InnerOnSwapMinimalCalled(SwapRequest request, uint256 balanceTokenIn, uint256 balanceTokenOut);
    event InnerOnJoinPoolCalled(address sender, uint256[] balances, bytes userData);
    event InnerOnExitPoolCalled(address sender, uint256[] balances, bytes userData);

    constructor(
        IVault vault,
        IVault.PoolSpecialization specialization,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        address[] memory assetManagers,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BasePool(
            vault,
            specialization,
            name,
            symbol,
            tokens,
            assetManagers,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _totalTokens = tokens.length;
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        emit InnerOnInitializePoolCalled(userData);

        uint256[] memory amountsIn = userData.initialAmountsIn();
        uint256 bptAmountOut;

        for (uint256 i = 0; i < amountsIn.length; i++) {
            bptAmountOut += amountsIn[i];
        }

        return (bptAmountOut, amountsIn);
    }

    function _onSwapMinimal(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal override returns (uint256) {
        emit InnerOnSwapMinimalCalled(request, balanceTokenIn, balanceTokenOut);
    }

    function _onSwapGeneral(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal override returns (uint256) {

    }

    function _onJoinPool(
        bytes32,
        address sender,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        emit InnerOnJoinPoolCalled(sender, balances, userData);

        return (0, new uint256[](balances.length));
    }

    function _onExitPool(
        bytes32,
        address sender,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        emit InnerOnExitPoolCalled(sender, balances, userData);

        return (0, new uint256[](balances.length));
    }

    function inRecoveryMode() public view override returns (bool) {
        return _inRecoveryMode;
    }

    function _setRecoveryMode(bool enabled) internal override {
        _inRecoveryMode = enabled;
    }

    function getScalingFactors() external pure override returns (uint256[] memory) {
        revert('Mock method; not implemented');
    }

    function getSwapFeePercentage() external pure override returns (uint256) {
        revert('Mock method; not implemented');
    }

    function payProtocolFees(uint256 bptAmount) public {
        _payProtocolFees(bptAmount);
    }

    function getMinimumBpt() external pure returns (uint256) {
        return _getMinimumBpt();
    }
}
