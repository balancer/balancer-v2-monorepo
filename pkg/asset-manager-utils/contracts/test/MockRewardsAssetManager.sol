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

pragma experimental ABIEncoderV2;

import "../RewardsAssetManager.sol";

pragma solidity ^0.7.0;

contract MockRewardsAssetManager is RewardsAssetManager {
    using Math for uint256;

    constructor(
        IVault _vault,
        bytes32 _poolId,
        IERC20 _token
    ) RewardsAssetManager(_vault, _poolId, _token) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function initialise(bytes32 pId) public {
        _initialise(pId);
    }

    function _invest(uint256 amount, uint256) internal pure override returns (uint256) {
        return amount;
    }

    function _divest(uint256 amount, uint256) internal pure override returns (uint256) {
        return amount;
    }

    function _getAUM() internal view override returns (uint256) {
        return token.balanceOf(address(this));
    }
}
