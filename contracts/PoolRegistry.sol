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

pragma solidity 0.5.12;

import "./utils/Lock.sol";
import "./utils/Logs.sol";
import "./BConst.sol";
import "./BNum.sol";
import "./BMath.sol";

contract PoolRegistry is BMath, Lock, Logs {
    struct Record {
        bool bound;   // is token bound to pool
        uint index;   // private
        uint denorm;  // denormalized weight
    }

    struct Pool {
        address controller; // has CONTROL role
        bool paused;

        // `setSwapFee` requires CONTROL
        uint swapFee;

        address[] tokens;
        mapping (address => Record) records;
        uint totalWeight;
    }

    mapping (bytes32 => Pool) public _pools; // temporarily making this public, keeping the underline prefix
    mapping (bytes32 => bool) _poolExists;
    mapping (bytes32 => mapping (address => uint)) _balances;
    mapping (address => uint) _allocatedBalances;

    modifier ensurePoolExists(bytes32 poolId) {
      require(_poolExists[poolId]);
      _;
    }

    event PoolCreated(bytes32 poolId);

    function newPool(bytes32 poolId) external returns (bytes32) {
        require(!_poolExists[poolId]);
        _poolExists[poolId] = true;

        _pools[poolId] = Pool({
            controller: msg.sender,
            swapFee: DEFAULT_SWAP_FEE,
            paused: true,
            tokens: new address[](0),
            totalWeight: 0
        });

        emit PoolCreated(poolId);

        return poolId;
    }

    function isPaused(bytes32 poolId) external view returns (bool) {
        return _pools[poolId].paused;
    }

    function isTokenBound(bytes32 poolId, address token) external view returns (bool) {
        return _pools[poolId].records[token].bound;
    }

    function getNumPoolTokens(bytes32 poolId) external view returns (uint) {
        return _pools[poolId].tokens.length;
    }

    function getPoolTokens(bytes32 poolId) external view _viewlock_ returns (address[] memory tokens) {
        return _pools[poolId].tokens;
    }

    function getPoolTokenBalance(bytes32 poolId, address token) external view returns (uint) {
        return _balances[poolId][token];
    }

    function getTokenDenormalizedWeight(bytes32 poolId, address token) external view _viewlock_ returns (uint) {
        require(_pools[poolId].records[token].bound, "ERR_NOT_BOUND");
        return _pools[poolId].records[token].denorm;
    }

    function getTotalDenormalizedWeight(bytes32 poolId) external view _viewlock_ returns (uint) {
        return _pools[poolId].totalWeight;
    }

    function getTokenNormalizedWeight(bytes32 poolId, address token) external view _viewlock_ returns (uint) {
        require(_pools[poolId].records[token].bound, "ERR_NOT_BOUND");
        uint denorm = _pools[poolId].records[token].denorm;
        return bdiv(denorm, _pools[poolId].totalWeight);
    }

    function getTokenBalance(bytes32 poolId, address token) external view _viewlock_ returns (uint) {
        require(_pools[poolId].records[token].bound, "ERR_NOT_BOUND");
        return _balances[poolId][token];
    }

    function getSwapFee(bytes32 poolId) external view _viewlock_ returns (uint) {
        return _pools[poolId].swapFee;
    }

    function getController(bytes32 poolId) external view _viewlock_ returns (address) {
        return _pools[poolId].controller;
    }

    function setSwapFee(bytes32 poolId, uint swapFee) external
    _logs_
    _lock_ 
    ensurePoolExists(poolId)
    {
        require(msg.sender == _pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
        _pools[poolId].swapFee = swapFee;
    }

    function setController(bytes32 poolId, address controller) external
    _logs_
    _lock_
    ensurePoolExists(poolId)
    {
        require(msg.sender == _pools[poolId].controller, "ERR_NOT_CONTROLLER");
        _pools[poolId].controller = controller;
    }

    function setPaused(bytes32 poolId, bool paused) external _logs_ _lock_ {
        require(msg.sender == _pools[poolId].controller, "ERR_NOT_CONTROLLER");
        _pools[poolId].paused = paused;
    }
}
