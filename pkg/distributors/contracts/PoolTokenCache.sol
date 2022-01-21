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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";

contract PoolTokenCache {
    using EnumerableSet for EnumerableSet.AddressSet;

    IVault public immutable vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    mapping(bytes32 => EnumerableSet.AddressSet) private _poolTokenSets;
    mapping(bytes32 => bool) private _poolTokenSetSaved;

    function savePoolTokenSet(bytes32 poolId) public {
        (IERC20[] memory poolTokens, , ) = vault.getPoolTokens(poolId);

        if (_poolTokenSetSaved[poolId]) {
            // Purge potentially stale cached data
            uint256 numTokens = _poolTokenSets[poolId].length();

            // Clear the set by removing the last element n times, which uses less gas than removing elements in any
            // other order.
            for (uint256 i = 0; i < numTokens; i++) {
                uint256 lastIndex = numTokens - 1 - i;

                address lastIndexAddress = _poolTokenSets[poolId].unchecked_at(lastIndex);
                _poolTokenSets[poolId].remove(lastIndexAddress);
            }
        } else {
            _poolTokenSetSaved[poolId] = true;
        }

        for (uint256 pt; pt < poolTokens.length; pt++) {
            _poolTokenSets[poolId].add(address(poolTokens[pt]));
        }
    }

    function ensurePoolTokenSetSaved(bytes32 poolId) public {
        if (!_poolTokenSetSaved[poolId]) {
            savePoolTokenSet(poolId);
        }
    }

    modifier withPoolTokenSetSaved(bytes32 poolId) {
        // create a set of the pool tokens if it doesn't exist
        ensurePoolTokenSetSaved(poolId);
        _;
    }

    function _getAssets(bytes32 poolId) internal view returns (IAsset[] memory assets) {
        uint256 numTokens = poolTokensLength(poolId);

        assets = new IAsset[](numTokens);
        for (uint256 pt; pt < numTokens; pt++) {
            assets[pt] = IAsset(_poolTokenSets[poolId].unchecked_at(pt));
        }
    }

    function _poolTokenIndex(bytes32 poolId, address token) internal view returns (uint256) {
        return _poolTokenSets[poolId].rawIndexOf(token);
    }

    function poolHasToken(bytes32 poolId, address token) public view returns (bool) {
        return _poolTokenSets[poolId].contains(token);
    }

    function poolTokensLength(bytes32 poolId) public view returns (uint256) {
        return _poolTokenSets[poolId].length();
    }

    function poolTokenAtIndex(bytes32 poolId, uint256 index) public view returns (address) {
        return _poolTokenSets[poolId].at(index);
    }
}
