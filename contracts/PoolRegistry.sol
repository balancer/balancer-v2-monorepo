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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "./utils/Lock.sol";
import "./utils/Logs.sol";
import "./BConst.sol";
import "./BNum.sol";
import "./BMath.sol";
import "./IVault.sol";

abstract contract PoolRegistry is BMath, Lock, Logs, IVault {
    struct Record {
        bool bound; // is token bound to pool
        uint8 index; // private
    }

    struct Pool {
        address controller; // has CONTROL role
        // `setSwapFee` requires CONTROL
        uint256 swapFee;
        address[] tokens; // For simpler pool configuration querying, not used internally
        address invariant;
    }

    mapping(bytes32 => mapping(address => Record)) public poolRecords;

    // temporarily making this public, we might want to provide a better API later on
    mapping(bytes32 => Pool) public pools;

    mapping(bytes32 => bool) internal _poolExists;
    // All tokens in a pool have non-zero balances
    mapping(bytes32 => mapping(address => uint256)) internal _poolTokenBalance; // poolid => token => pool balance
    mapping(address => uint256) internal _allocatedBalances;

    modifier ensurePoolExists(bytes32 poolId) {
        require(_poolExists[poolId], "Inexistent pool");
        _;
    }

    modifier onlyPoolController(bytes32 poolId) {
        require(
            pools[poolId].controller == msg.sender,
            "Caller is not the pool controller"
        );
        _;
    }

    event PoolCreated(bytes32 poolId);

    function newPool(bytes32 poolId, address invariant)
        external
        override
        returns (bytes32)
    {
        require(!_poolExists[poolId], "Pool ID already exists");
        require(invariant != address(0), "Invariant must be set");
        _poolExists[poolId] = true;

        pools[poolId] = Pool({
            controller: msg.sender,
            swapFee: DEFAULT_SWAP_FEE,
            tokens: new address[](0),
            invariant: invariant
        });

        emit PoolCreated(poolId);

        return poolId;
    }

    function isTokenBound(bytes32 poolId, address token)
        external
        override
        view
        returns (bool)
    {
        return poolRecords[poolId][token].bound;
    }

    function getNumPoolTokens(bytes32 poolId)
        external
        override
        view
        returns (uint256)
    {
        return pools[poolId].tokens.length;
    }

    function getPoolTokens(bytes32 poolId)
        external
        override
        view
        _viewlock_
        returns (address[] memory tokens)
    {
        return pools[poolId].tokens;
    }

    function getPoolTokenBalances(bytes32 poolId, address[] calldata tokens)
        external
        override
        view
        returns (uint256[] memory)
    {
        uint256[] memory balances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = _poolTokenBalance[poolId][tokens[i]];
        }

        return balances;
    }

    function getSwapFee(bytes32 poolId)
        external
        override
        view
        _viewlock_
        returns (uint256)
    {
        return pools[poolId].swapFee;
    }

    function getController(bytes32 poolId)
        external
        override
        view
        _viewlock_
        returns (address)
    {
        return pools[poolId].controller;
    }

    function getInvariant(bytes32 poolId)
        external
        override
        view
        _viewlock_
        returns (address)
    {
        return pools[poolId].invariant;
    }

    function getTokenIndex(bytes32 poolId, address token)
        external
        override
        view
        _viewlock_
        returns (uint8)
    {
        return poolRecords[poolId][token].index;
    }

    function setSwapFee(bytes32 poolId, uint256 swapFee)
        external
        override
        _logs_
        _lock_
        ensurePoolExists(poolId)
        onlyPoolController(poolId)
    {
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
        pools[poolId].swapFee = swapFee;
    }

    function setController(bytes32 poolId, address controller)
        external
        override
        _logs_
        _lock_
        ensurePoolExists(poolId)
        onlyPoolController(poolId)
    {
        pools[poolId].controller = controller;
    }
}
