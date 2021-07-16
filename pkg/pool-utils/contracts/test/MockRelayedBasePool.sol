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

import "../BasePool.sol";
import "../RelayedBasePool.sol";

contract MockRelayedBasePool is BasePool, RelayedBasePool {
    uint256 private constant _MINIMUM_BPT = 1e6;

    uint256 private immutable _totalTokens;

    event Join(bytes32 poolId, address sender, address recipient, bytes userData, uint256[] balances);

    event Exit(bytes32 poolId, address sender, address recipient, bytes userData, uint256[] balances);

    constructor(
        IVault vault,
        IVault.PoolSpecialization specialization,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        IBasePoolRelayer relayer,
        address owner
    )
        BasePool(
            vault,
            specialization,
            name,
            symbol,
            tokens,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
        RelayedBasePool(relayer)
    {
        _totalTokens = tokens.length;
    }

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public override(BasePool, RelayedBasePool) returns (uint256[] memory, uint256[] memory) {
        emit Join(poolId, sender, recipient, userData, balances);
        return
            RelayedBasePool.onJoinPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                protocolSwapFeePercentage,
                userData
            );
    }

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public override(BasePool, RelayedBasePool) returns (uint256[] memory, uint256[] memory) {
        emit Exit(poolId, sender, recipient, userData, balances);
        return
            RelayedBasePool.onExitPool(
                poolId,
                sender,
                recipient,
                balances,
                lastChangeBlock,
                protocolSwapFeePercentage,
                userData
            );
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory,
        bytes memory
    ) internal view override returns (uint256, uint256[] memory) {
        return (_MINIMUM_BPT * 2, _ones());
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
    )
        internal
        view
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        return (_MINIMUM_BPT * 2, _ones(), _zeros());
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
    )
        internal
        view
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        return (_MINIMUM_BPT, _ones(), _zeros());
    }

    function _zeros() private view returns (uint256[] memory) {
        return new uint256[](_getTotalTokens());
    }

    function _ones() private view returns (uint256[] memory ones) {
        ones = new uint256[](_getTotalTokens());
        for (uint256 i = 0; i < ones.length; i++) {
            ones[i] = FixedPoint.ONE;
        }
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return 8;
    }

    function _getTotalTokens() internal view override returns (uint256) {
        return _totalTokens;
    }

    function _scalingFactor(IERC20) internal pure override returns (uint256) {
        return FixedPoint.ONE;
    }

    function _scalingFactors() internal view override returns (uint256[] memory scalingFactors) {
        uint256 numTokens = _getTotalTokens();

        scalingFactors = new uint256[](numTokens);
        for (uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = FixedPoint.ONE;
        }
    }
}
