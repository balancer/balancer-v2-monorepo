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
            uint256 numTokens = _poolTokenSets[poolId].length();
            for (uint256 t; t < numTokens; t++) {
                // always the 0 index since we're removing all elements
                address tokenAddress = _poolTokenSets[poolId].unchecked_at(0);
                _poolTokenSets[poolId].remove(tokenAddress);
            }
        }
        for (uint256 pt; pt < poolTokens.length; pt++) {
            _poolTokenSets[poolId].add(address(poolTokens[pt]));
        }
        _poolTokenSetSaved[poolId] = true;
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

    function poolHasToken(bytes32 poolId, address token) public view returns (bool) {
        return _poolTokenSets[poolId].contains(token);
    }

    function poolTokenIndex(bytes32 poolId, address token) public view returns (uint256) {
        return _poolTokenSets[poolId].rawIndexOf(token);
    }

    function poolTokensLength(bytes32 poolId) public view returns (uint256) {
        return _poolTokenSets[poolId].length();
    }
}
