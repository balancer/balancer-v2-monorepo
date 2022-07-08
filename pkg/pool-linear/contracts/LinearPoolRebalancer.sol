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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IBalancerQueries.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/ILinearPool.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/IStaticAToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

contract LinearPoolRebalancer {
    using SafeERC20 for IERC20;

    ILinearPool private immutable _pool;
    bytes32 private immutable _poolId;

    IERC20 private immutable _mainToken;
    IERC20 private immutable _wrappedToken;

    uint256 private immutable _mainTokenScalingFactor;

    IVault private immutable _vault;

    IBalancerQueries private immutable _queries;

    constructor(
        ILinearPool pool,
        IVault vault,
        IBalancerQueries queries
    ) {
        _mainTokenScalingFactor = pool.getScalingFactors()[pool.getMainIndex()];

        _pool = pool;
        _poolId = pool.getPoolId();
        _mainToken = pool.getMainToken();
        _wrappedToken = pool.getWrappedToken();
        _vault = vault;
        _queries = queries;
    }

    function rebalance() public {
        // 1. query swap to get balance to middle of acceptable range. Store swap parameters (input and output amts)
        // 2. with AM power, withdraw excess token
        // 3. transact with AAVE to swap tokens
        // 4. deposit under-excess token into protocol
        // 5. walk away with difference between amounts from 1. and 4.

        // The first thing we need to determine if whether the Pool is below or above the target level, which will
        // inform whether we need to deposit or withdraw main tokens.
        uint256 desiredMainTokenBalance = _getDesiredMainTokenBalance();

        // For a 3 token General Pool, it is cheaper to query the balance for a single token than to read all balances,
        // as getPoolTokenInfo will check for token existence, token balance and Asset Manager (3 reads), while
        // getPoolTokens will read the number of tokens, their addresses and balances (7 reads).
        // We can assume that the managed balance is zero (since we're the Pool's Asset Manager and we always set it to
        // zero), and work with the cash directly as if it were the total balance.
        (uint256 mainTokenBalance, , , ) = _vault.getPoolTokenInfo(_poolId, _mainToken);

        if (mainTokenBalance < desiredMainTokenBalance) {
            _rebalanceLackOfMainToken(desiredMainTokenBalance - mainTokenBalance);
        } else {
            _rebalanceExcessOfMainToken(mainTokenBalance - desiredMainTokenBalance);
        }
    }

    function _rebalanceLackOfMainToken(uint256 missingMainAmount) private {
        // The Pool desires more main token, so we prepare a swap where we provide the missing main token amount in
        // exchange for wrapped tokens, that is, the main token is the token in. Since we know this amount, this is a
        // 'given in' swap.
        IVault.SingleSwap memory swap = IVault.SingleSwap({
            poolId: _poolId,
            kind: IVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(address(_mainToken)),
            assetOut: IAsset(address(_wrappedToken)),
            amount: missingMainAmount,
            userData: ""
        });

        // We can now query how much wrapped token the Pool would return if we were to execute this swap. The Linear
        // Pool invariant guarantees that this amount can be unwrapped to an amount greater than `missingMainAmount`,
        // with the difference originating from swap fees.

        IVault.FundManagement memory funds; // This is unused in the query, so we don't bother initializing it.
        uint256 wrappedAmountOut = _queries.querySwap(swap, funds);

        // Since we lack the main tokens required to actually execute the swap, we instead use our Asset Manager
        // permission to withdraw wrapped tokens from the Pool, unwrap them, and then deposit them as main tokens.
        // The amounts involved will be the exact same amounts as the one in the swap above, meaning the overall state
        // transition will be the same, except we will never actually call the Linear Pool. However, since the Linear
        // Pool's `onSwap` function is `view`, this is irrelevant.

        _withdrawFromPool(_wrappedToken, wrappedAmountOut);
        _unwrapTokens(wrappedAmountOut);
        _depositToPool(_mainToken, missingMainAmount);

        // This contract will now hold excess main token, since unwrapping `wrappedAmountOut` should have resulted in
        // more than `missingMainAmount` being obtained. These are sent to the caller to pay back for the gas of this
        // execution.
        _mainToken.safeTransfer(msg.sender, _mainToken.balanceOf(address(this)));
    }

    function _rebalanceExcessOfMainToken(uint256 excessMainAmount) private {
        // The Pool desires less main token, so we do a swap where we take the excess main token amount and send wrapped
        // tokens in exchange, that is, the main token is the token out. Since we know this amount, this is a 'given
        // out' swap.
        IVault.SingleSwap memory swap = IVault.SingleSwap({
            poolId: _poolId,
            kind: IVault.SwapKind.GIVEN_OUT,
            assetIn: IAsset(address(_wrappedToken)),
            assetOut: IAsset(address(_mainToken)),
            amount: excessMainAmount,
            userData: ""
        });

        // We can now query how much wrapped token we would need to send to the Pool if we were to execute this swap.
        // The Linear Pool invariant guarantees that this amount is less than what would be obtained by wrapping
        // `excessMainAmount`, with the difference originating from swap fees.

        IVault.FundManagement memory funds; // This is unused in the query, so we don't bother initializing it.
        uint256 wrappedAmountIn = _queries.querySwap(swap, funds);

        // Since we lack the wrapepd tokens required to actually execute the swap, we instead use our Asset Manager
        // permission to withdraw main tokens from the Pool, wrap them, and then deposit them as wrapped tokens. The
        // amounts involved will be the exact same amounts as the one in the swap above, meaning the overall state
        // transition will be the same, except we will never actually call the Linear Pool. However, since the Linear
        // Pool's `onSwap` function is `view`, this is irrelevant.

        _withdrawFromPool(_mainToken, excessMainAmount);
        _wrapTokens(excessMainAmount);
        _depositToPool(_wrappedToken, wrappedAmountIn);

        // Any excess wrapped token is transfered to the sender
        _wrappedToken.safeTransfer(msg.sender, _wrappedToken.balanceOf(address(this)));
    }

    function _withdrawFromPool(IERC20 token, uint256 amount) private {
        // Tokens can be withdrawn from the Vault with a 'withdraw' operation, but that will create 'managed' balance
        // and leave the 'total' balance unchanged. We therefore have to perform two operations: one to withdraw, and
        // another to clear the 'managed' balance (as the tokens withdrawn are about to be wrapped or unwrapped, and
        // therefore lost to the Pool in their current format).
        IVault.PoolBalanceOp[] memory withdrawal = new IVault.PoolBalanceOp[](2);

        // First, we withdraw the tokens, creating 'managed' balance in the Pool.
        withdrawal[0].kind = IVault.PoolBalanceOpKind.WITHDRAW;
        withdrawal[0].poolId = _poolId;
        withdrawal[0].amount = amount;
        withdrawal[0].token = token;

        // Then, we clear the 'managed' balance.
        withdrawal[1].kind = IVault.PoolBalanceOpKind.UPDATE;
        withdrawal[1].poolId = _poolId;
        withdrawal[1].amount = 0;
        withdrawal[1].token = token;

        _vault.managePoolBalance(withdrawal);
    }

    function _depositToPool(IERC20 token, uint256 amount) private {
        // Tokens can be deposited to the Vault with a 'deposit' operation, but that requires for prior 'managed'
        // balance to exist. We therefore have to perform two operations: one to set the 'managed' balance (representing
        // the new tokens that resulted from wrapping or unwrapping and which we are managing for the Pool), and
        // another to deposit.
        IVault.PoolBalanceOp[] memory deposit = new IVault.PoolBalanceOp[](2);

        // First, we inform the Vault of the 'managed' tokens.
        deposit[0].kind = IVault.PoolBalanceOpKind.UPDATE;
        deposit[0].poolId = _poolId;
        deposit[0].amount = amount;
        deposit[0].token = token;

        // Then, we deposit them, clearing the 'managed' balance.
        deposit[1].kind = IVault.PoolBalanceOpKind.DEPOSIT;
        deposit[1].poolId = _poolId;
        deposit[1].amount = amount;
        deposit[1].token = token;

        _vault.managePoolBalance(deposit);
    }

    function _getDesiredMainTokenBalance() private view returns (uint256) {
        // The desired main token balance is the midpoint of the lower and upper targets, which aims to maximize Pool swap
        // volume by allowing for swaps in both directions with no rebalancing fees.
        (uint256 lowerTarget, uint256 upperTarget) = _pool.getTargets();
        uint256 midpoint = (lowerTarget + upperTarget) / 2;

        // The targets are upscaled by the main token's scaling factor, so we undo that. Note that we're assuming that
        // the main token's scaling factor is constant.
        return FixedPoint.divDown(midpoint, _mainTokenScalingFactor);
    }

    function _wrapTokens(uint256 amount) private {
        IStaticAToken(address(_wrappedToken)).deposit(address(this), amount, 0, true);
    }

    function _unwrapTokens(uint256 amount) private {
        IStaticAToken(address(_wrappedToken)).withdraw(address(this), amount, true);
    }
}
