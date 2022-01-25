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

import "@balancer-labs/v2-vault/contracts/interfaces/IBasePool.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

/**
 * @dev Standalone registry for Pool-related miscellaneous information. Useful to e.g. store links to related webapps,
 * analytics dashboards, etc.
 *
 * Since the expected consumers of this registry are off-chain applications, comments are not stored in this contract's
 * storage but instead emitted as events. Since all comments reside in this single contract, advanced infrastructure
 * like a subgraph is unnecessary: simply filtering this contract's events is sufficient.
 */
contract PoolCommentRegistry {
    event PoolCommentAdded(address indexed sender, bytes32 indexed poolId, string comment);

    IVault private _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function addPoolIdComment(bytes32 poolId, string memory comment) external {
        _addPoolComment(poolId, comment);
    }

    function addPoolComment(address pool, string memory comment) external {
        _addPoolComment(IBasePool(pool).getPoolId(), comment);
    }

    function _addPoolComment(bytes32 poolId, string memory comment) private {
        // We want to check that `poolId` corresponds to a valid Pool to avoid incorrect entries, but lack a way to
        // check this directly. The simplest approach is to call `vault.getPool()` - we ignore the return values, as
        // what we're interested in is the fact that this call will revert if the Pool was not registered.
        _vault.getPool(poolId);

        emit PoolCommentAdded(msg.sender, poolId, comment);
    }
}
