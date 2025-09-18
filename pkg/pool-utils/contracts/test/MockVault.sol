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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IBasePool.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IGeneralPool.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IPoolSwapStructs.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IMinimalSwapInfoPool.sol";

import "@balancer-labs/v2-vault/contracts/ProtocolFeesCollector.sol";

contract MockVault is IPoolSwapStructs, ReentrancyGuard {
    struct Pool {
        IERC20[] tokens;
        mapping(IERC20 => uint256) cash;
        mapping(IERC20 => uint256) managed;
    }

    IAuthorizer private _authorizer;
    IProtocolFeesCollector private _protocolFeesCollector;

    mapping(bytes32 => Pool) private pools;

    mapping(bytes32 => bool) private _isPoolRegistered;

    // We keep an increasing nonce to make Pool IDs unique. It is interpreted as a `uint80`, but storing it as a
    // `uint256` results in reduced bytecode on reads and writes due to the lack of masking.
    uint256 private _nextPoolNonce;

    event Swap(
        bytes32 indexed poolId,
        IERC20 indexed tokenIn,
        IERC20 indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event PoolBalanceChanged(
        bytes32 indexed poolId,
        address indexed liquidityProvider,
        IERC20[] tokens,
        int256[] deltas,
        uint256[] protocolFeeAmounts
    );

    modifier withRegisteredPool(bytes32 poolId) {
        _ensureRegisteredPool(poolId);
        _;
    }

    constructor(IAuthorizer authorizer) {
        _authorizer = authorizer;
        _protocolFeesCollector = new ProtocolFeesCollector(IVault(address(this)));
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _authorizer;
    }

    function getProtocolFeesCollector() public view returns (IProtocolFeesCollector) {
        return _protocolFeesCollector;
    }

    function getPoolTokens(bytes32 poolId) external view returns (IERC20[] memory tokens, uint256[] memory balances) {
        Pool storage pool = pools[poolId];
        tokens = new IERC20[](pool.tokens.length);
        balances = new uint256[](pool.tokens.length);

        for (uint256 i = 0; i < pool.tokens.length; i++) {
            tokens[i] = pool.tokens[i];
            balances[i] = pool.cash[tokens[i]] + pool.managed[tokens[i]];
        }
    }

    function getPoolTokenInfo(bytes32 poolId, IERC20 token)
        external
        view
        returns (
            uint256 cash,
            uint256 managed,
            uint256,
            address
        )
    {
        Pool storage pool = pools[poolId];
        cash = pool.cash[token];
        managed = pool.managed[token];
    }

    function registerPool(IVault.PoolSpecialization specialization)
        external
        nonReentrant
        returns (bytes32)
    {
        // Each Pool is assigned a unique ID based on an incrementing nonce. This assumes there will never be more than
        // 2**80 Pools, and the nonce will not overflow.

        bytes32 poolId = _toPoolId(msg.sender, specialization, uint80(_nextPoolNonce));

        _require(!_isPoolRegistered[poolId], Errors.INVALID_POOL_ID); // Should never happen as Pool IDs are unique.
        _isPoolRegistered[poolId] = true;

        _nextPoolNonce += 1;

        return poolId;
    }

    function getPool(bytes32 poolId)
        external
        view
        withRegisteredPool(poolId)
        returns (address, IVault.PoolSpecialization)
    {
        return (_getPoolAddress(poolId), _getPoolSpecialization(poolId));
    }

    function registerTokens(
        bytes32 poolId,
        IERC20[] memory tokens,
        address[] memory
    ) external {
        Pool storage pool = pools[poolId];
        for (uint256 i = 0; i < tokens.length; i++) {
            pool.tokens.push(tokens[i]);
        }
    }

    function updateCash(bytes32 poolId, uint256[] memory cash) external {
        Pool storage pool = pools[poolId];
        for (uint256 i = 0; i < cash.length; i++) {
            pool.cash[pool.tokens[i]] = cash[i];
        }
    }

    function updateManaged(bytes32 poolId, uint256[] memory managed) external {
        Pool storage pool = pools[poolId];
        for (uint256 i = 0; i < managed.length; i++) {
            pool.managed[pool.tokens[i]] = managed[i];
        }
    }

    function callMinimalPoolSwap(
        address pool,
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) external {
        uint256 amountCalculated = IMinimalSwapInfoPool(pool).onSwap(request, balanceTokenIn, balanceTokenOut);
        (uint256 amountIn, uint256 amountOut) = request.kind == IVault.SwapKind.GIVEN_IN
            ? (request.amount, amountCalculated)
            : (amountCalculated, request.amount);
        emit Swap(request.poolId, request.tokenIn, request.tokenOut, amountIn, amountOut);
    }

    function callGeneralPoolSwap(
        address pool,
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external {
        uint256 amountCalculated = IGeneralPool(pool).onSwap(request, balances, indexIn, indexOut);
        (uint256 amountIn, uint256 amountOut) = request.kind == IVault.SwapKind.GIVEN_IN
            ? (request.amount, amountCalculated)
            : (amountCalculated, request.amount);
        emit Swap(request.poolId, request.tokenIn, request.tokenOut, amountIn, amountOut);
    }

    function callJoinPool(
        address poolAddress,
        bytes32 poolId,
        address recipient,
        uint256[] memory currentBalances,
        uint256 lastChangeBlock,
        uint256 protocolFeePercentage,
        bytes memory userData
    ) external {
        (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = IBasePool(poolAddress).onJoinPool(
            poolId,
            msg.sender,
            recipient,
            currentBalances,
            lastChangeBlock,
            protocolFeePercentage,
            userData
        );

        Pool storage pool = pools[poolId];
        for (uint256 i = 0; i < pool.tokens.length; i++) {
            pool.cash[pool.tokens[i]] += amountsIn[i];
        }

        IERC20[] memory tokens = new IERC20[](currentBalances.length);
        int256[] memory deltas = new int256[](amountsIn.length);
        for (uint256 i = 0; i < amountsIn.length; ++i) {
            deltas[i] = int256(amountsIn[i]);
        }

        emit PoolBalanceChanged(poolId, msg.sender, tokens, deltas, dueProtocolFeeAmounts);
    }

    function callExitPool(
        address poolAddress,
        bytes32 poolId,
        address recipient,
        uint256[] memory currentBalances,
        uint256 lastChangeBlock,
        uint256 protocolFeePercentage,
        bytes memory userData
    ) external {
        (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) = IBasePool(poolAddress).onExitPool(
            poolId,
            msg.sender,
            recipient,
            currentBalances,
            lastChangeBlock,
            protocolFeePercentage,
            userData
        );

        Pool storage pool = pools[poolId];
        for (uint256 i = 0; i < pool.tokens.length; i++) {
            pool.cash[pool.tokens[i]] -= amountsOut[i];
        }

        IERC20[] memory tokens = new IERC20[](currentBalances.length);
        int256[] memory deltas = new int256[](amountsOut.length);
        for (uint256 i = 0; i < amountsOut.length; ++i) {
            deltas[i] = int256(-amountsOut[i]);
        }

        emit PoolBalanceChanged(poolId, msg.sender, tokens, deltas, dueProtocolFeeAmounts);
    }

    // Needed to support authorizer adaptor entrypoint
    function getActionId(bytes4 selector) public view returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(uint256(address(this))), selector));
    }

    function setAuthorizer(IAuthorizer newAuthorizer) external {
        _authorizer = newAuthorizer;
    }

    // This supports calls from the VaultReentrancyLib in unit tests, so that they don't revert.
    function manageUserBalance(IVault.UserBalanceOp[] memory) external payable nonReentrant {
        // solhint-disable-previous-line no-empty-blocks
    }

    // The real Vault doesn't have any hooks that are view functions, so add one to this Vault
    // specifically to test read-only reentrancy protection on view functions.
    function functionWithHook(address pool) external nonReentrant {
        (bool success, bytes memory returnData) = pool.call(abi.encodeWithSignature("viewHook()"));
        
        if (!success && returnData.length > 0) {
            // The easiest way to bubble the revert reason is using memory via assembly
            // solhint-disable-next-line no-inline-assembly
            assembly {
                let returndata_size := mload(returnData)
                revert(add(32, returnData), returndata_size)
            }
        }
    }

    // From PoolRegistry

    function _ensureRegisteredPool(bytes32 poolId) internal view {
        _require(_isPoolRegistered[poolId], Errors.INVALID_POOL_ID);
    }

    function _toPoolId(
        address pool,
        IVault.PoolSpecialization specialization,
        uint80 nonce
    ) internal pure returns (bytes32) {
        bytes32 serialized;

        serialized |= bytes32(uint256(nonce));
        serialized |= bytes32(uint256(specialization)) << (10 * 8);
        serialized |= bytes32(uint256(pool)) << (12 * 8);

        return serialized;
    }

    function _getPoolAddress(bytes32 poolId) internal pure returns (address) {
        // 12 byte logical shift left to remove the nonce and specialization setting. We don't need to mask,
        // since the logical shift already sets the upper bits to zero.
        return address(uint256(poolId) >> (12 * 8));
    }

    function _getPoolSpecialization(bytes32 poolId) internal pure returns (IVault.PoolSpecialization specialization) {
        // 10 byte logical shift left to remove the nonce, followed by a 2 byte mask to remove the address.
        uint256 value = uint256(poolId >> (10 * 8)) & (2**(2 * 8) - 1);

        _require(value < 3, Errors.INVALID_POOL_ID);

        // Because we have checked that `value` is within the enum range, we can use assembly to skip the runtime check.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            specialization := value
        }
    }
}
