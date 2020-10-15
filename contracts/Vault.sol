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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@nomiclabs/buidler/console.sol";

import "./PoolRegistry.sol";

import "./ISwapCaller.sol";

import "./LogExpMath.sol";

contract Vault is PoolRegistry {
    mapping(address => uint256) private _tokenBalances;

    // Bind does not lock because it jumps to `rebind`, which does
    function bind(
        bytes32 poolId,
        address token,
        uint256 balance,
        uint256 denorm
    ) external override _logs_ {
        require(msg.sender == pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(!poolRecords[poolId][token].bound, "ERR_IS_BOUND");

        require(
            pools[poolId].tokens.length < MAX_BOUND_TOKENS,
            "ERR_MAX_TOKENS"
        );

        poolRecords[poolId][token] = Record({
            bound: true,
            index: pools[poolId].tokens.length,
            denorm: 0 // denorm will be validated by rebind()
        });
        pools[poolId].tokens.push(token);
        rebind(poolId, token, balance, denorm);
    }

    function rebind(
        bytes32 poolId,
        address token,
        uint256 balance,
        uint256 denorm
    ) public override _logs_ _lock_ {
        require(msg.sender == pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(poolRecords[poolId][token].bound, "ERR_NOT_BOUND");

        require(denorm >= MIN_WEIGHT, "ERR_MIN_WEIGHT");
        require(denorm <= MAX_WEIGHT, "ERR_MAX_WEIGHT");
        require(balance >= MIN_BALANCE, "ERR_MIN_BALANCE");

        // Adjust the denorm and totalWeight
        uint256 oldWeight = poolRecords[poolId][token].denorm;
        if (denorm > oldWeight) {
            pools[poolId].totalWeight = badd(
                pools[poolId].totalWeight,
                bsub(denorm, oldWeight)
            );
            require(
                pools[poolId].totalWeight <= MAX_TOTAL_WEIGHT,
                "ERR_MAX_TOTAL_WEIGHT"
            );
        } else if (denorm < oldWeight) {
            pools[poolId].totalWeight = bsub(
                pools[poolId].totalWeight,
                bsub(oldWeight, denorm)
            );
        }
        poolRecords[poolId][token].denorm = denorm;

        // Adjust the balance record and actual token balance
        uint256 oldBalance = _balances[poolId][token];
        _balances[poolId][token] = balance;

        if (balance > oldBalance) {
            _pullUnderlying(token, msg.sender, bsub(balance, oldBalance));
        } else if (balance < oldBalance) {
            // TODO: charge exit fee
            _pushUnderlying(token, msg.sender, bsub(oldBalance, balance));
        }
    }

    function unbind(bytes32 poolId, address token)
        external
        override
        _logs_
        _lock_
    {
        require(msg.sender == pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(poolRecords[poolId][token].bound, "ERR_NOT_BOUND");

        uint256 tokenBalance = _balances[poolId][token];

        pools[poolId].totalWeight = bsub(
            pools[poolId].totalWeight,
            poolRecords[poolId][token].denorm
        );

        // Swap the token-to-unbind with the last token,
        // then delete the last token
        uint256 index = poolRecords[poolId][token].index;
        uint256 last = pools[poolId].tokens.length - 1;
        pools[poolId].tokens[index] = pools[poolId].tokens[last];
        poolRecords[poolId][pools[poolId].tokens[index]].index = index;
        pools[poolId].tokens.pop();
        poolRecords[poolId][token] = Record({
            bound: false,
            index: 0,
            denorm: 0
        });

        // TODO: charge exit fee
        _pushUnderlying(token, msg.sender, tokenBalance);
    }

    function getSpotPrice(
        bytes32 poolId,
        address tokenIn,
        address tokenOut
    ) external override view _viewlock_ returns (uint256 spotPrice) {
        Record storage inRecord = poolRecords[poolId][tokenIn];
        uint256 inRecordBalance = _balances[poolId][tokenIn];
        Record storage outRecord = poolRecords[poolId][tokenOut];
        uint256 outRecordBalance = _balances[poolId][tokenOut];

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        return
            calcSpotPrice(
                inRecordBalance,
                inRecord.denorm,
                outRecordBalance,
                outRecord.denorm,
                pools[poolId].swapFee
            );
    }

    function getSpotPriceSansFee(
        bytes32 poolId,
        address tokenIn,
        address tokenOut
    ) external override view _viewlock_ returns (uint256 spotPrice) {
        Record storage inRecord = poolRecords[poolId][tokenIn];
        uint256 inRecordBalance = _balances[poolId][tokenIn];
        Record storage outRecord = poolRecords[poolId][tokenOut];
        uint256 outRecordBalance = _balances[poolId][tokenOut];

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        return
            calcSpotPrice(
                inRecordBalance,
                inRecord.denorm,
                outRecordBalance,
                outRecord.denorm,
                0
            );
    }

    function batchSwap(
        Diff[] memory diffs,
        Swap[] memory swaps,
        address recipient,
        bytes memory callbackData
    ) public override {
        //TODO: avoid reentrancy

        // TODO: check tokens in diffs are unique. Is this necessary? Would avoid multiple valid diff
        // indexes pointing to the same token.
        // A simple way to implement this is to require the addresses to be sorted, and require strict
        // inequality

        for (uint256 i = 0; i < diffs.length; ++i) {
            require(diffs[i].vaultDelta == 0, "Bad workspace");
        }

        // TODO: check each pool only appears in a single swap. Might be overly restrictive, but easy
        // to implement (require swaps array to be sorted by poolId).

        // Steps 1, 2 & 3:
        //  - validate hints
        //  - check new pool balances are valid
        //  - accumulate token diffs
        //  - update pool balances

        for (uint256 i = 0; i < swaps.length; ++i) {
            Swap memory swap = swaps[i];
            Pool storage pool = pools[swap.poolId];

            // TODO: account for swap fees

            // 1.1.a: Validate hints and new balance for token A

            // Validate Pool has Token A and diff index is correct
            address tokenA = diffs[swap.tokenA.tokenDiffIndex].token;

            Record memory recordA = poolRecords[swap.poolId][tokenA];
            uint256 recordABalance = _balances[swap.poolId][tokenA];

            // Validate swap alters pool's balance for token A
            require(swap.tokenA.balance != recordABalance, "NOOP");

            // 1.1.b: Validate hints and new balance for token B

            // Validate Pool has Token B and diff index is correct
            address tokenB = diffs[swap.tokenB.tokenDiffIndex].token;

            Record memory recordB = poolRecords[swap.poolId][tokenB];
            uint256 recordBBalance = _balances[swap.poolId][tokenB];

            // Validate swap alters pool's balance for token B
            require(swap.tokenB.balance != recordBBalance, "NOOP");

            // 1.2: Accumulate token diffs
            int256 balanceADelta = int256(swap.tokenA.balance - recordABalance); // TODO: check overflow
            diffs[swap.tokenA.tokenDiffIndex].vaultDelta += balanceADelta;

            int256 balanceBDelta = int256(swap.tokenB.balance - recordBBalance); // TODO: check overflow
            diffs[swap.tokenB.tokenDiffIndex].vaultDelta += balanceBDelta;

            // 2: Check new balances are valid without considering fee.
            // Fees are always charged from tokenA regardless if is a token entering or exiting the pool.
            uint256 tokenABalanceMinusFee = swap.tokenA.balance -
                bmul(abs(balanceADelta), pool.swapFee);

            require(
                _validateBalances(
                    // Temporary in-memory struct to reduce stack usage (stack-too-deep error),
                    // we'll regardless need such an abstraction once we extract the curves from
                    // the vault
                    PoolStateTransition({
                        oldBalanceA: recordABalance,
                        oldBalanceB: recordBBalance,
                        newBalanceA: tokenABalanceMinusFee,
                        newBalanceB: swap.tokenB.balance
                    }),
                    bdiv(recordA.denorm, pool.totalWeight),
                    bdiv(recordB.denorm, pool.totalWeight)
                ),
                "ERR_INVALID_SWAP"
            );

            // 3: update pool balances
            _balances[swap.poolId][tokenA] = swap.tokenA.balance;
            _balances[swap.poolId][tokenB] = swap.tokenB.balance;
        }

        // Step 4: measure current balance for tokens that need to be received
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta > 0) {
                // Change positive deltas into expected final balances
                diff.vaultDelta += int256(
                    IERC20(diff.token).balanceOf(address(this))
                ); //TODO: check overflows
            }
        }

        // Call into sender to trigger token receipt
        ISwapCaller(msg.sender).sendTokens(callbackData);

        // Step 5: check tokens have been received
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta > 0) {
                uint256 newBalance = IERC20(diff.token).balanceOf(
                    address(this)
                );

                // TODO: check strict equality? Might not be feasible due to approximations
                require(
                    newBalance >= uint256(diff.vaultDelta),
                    "ERR_INVALID_DEPOSIT"
                );

                // Update token balance
                _tokenBalances[diff.token] = newBalance;
            }
        }

        // Step 6: send out tokens to send
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta < 0) {
                // Make delta positive
                uint256 amount = uint256(-diff.vaultDelta);

                _pushUnderlying(diff.token, recipient, amount);
            }
        }
    }

    struct PoolStateTransition {
        uint256 oldBalanceA;
        uint256 oldBalanceB;
        uint256 newBalanceA;
        uint256 newBalanceB;
    }

    function _validateBalances(
        PoolStateTransition memory transition,
        uint256 normalizedWeightA,
        uint256 normalizedWeightB
    ) private pure returns (bool) {
        //Balances should never be zero
        require(
            transition.newBalanceA > 0 && transition.newBalanceB > 0,
            "ERR_INVALID_BALANCE"
        );

        uint256 oldValue = bmul(
            uint256(
                LogExpMath.exp(
                    int256(transition.oldBalanceA),
                    int256(normalizedWeightA)
                )
            ),
            uint256(
                LogExpMath.exp(
                    int256(transition.oldBalanceB),
                    int256(normalizedWeightB)
                )
            )
        );

        uint256 newValue = bmul(
            uint256(
                LogExpMath.exp(
                    int256(transition.newBalanceA),
                    int256(normalizedWeightA)
                )
            ),
            uint256(
                LogExpMath.exp(
                    int256(transition.newBalanceB),
                    int256(normalizedWeightB)
                )
            )
        );

        // Require value to remain or increase, even if this means the trader is not being optimal
        if (newValue >= oldValue) {
            return true;
        } else {
            // We can't use strict comparison due to the different approximations involved. For
            // the values to be 'equal', their difference should be less than exp error
            // multiplied. 137*10^(-17) * 137*10^(-17).

            // TODO: this value is actually much lower - make the check stricter
            return bsub(BONE, bdiv(newValue, oldValue)) < 1876900;
        }
    }

    function addInitialLiquidity(
        bytes32 poolId,
        address[] calldata initialTokens,
        uint256[] calldata initialBalances
    ) external override onlyPoolController(poolId) {
        pools[poolId].tokens = initialTokens;

        for (uint256 i = 0; i < initialTokens.length; ++i) {
            address t = initialTokens[i];
            uint256 tokenAmountIn = initialBalances[i];
            require(tokenAmountIn != 0, "ERR_MATH_APPROX");
            require(
                bsub(
                    IERC20(t).balanceOf(address(this)),
                    _allocatedBalances[t]
                ) >= tokenAmountIn,
                "INSUFFICIENT UNALLOCATED BALANCE"
            );

            _balances[poolId][t] = tokenAmountIn;
            _allocatedBalances[t] = badd(_allocatedBalances[t], tokenAmountIn);
        }
    }

    function addLiquidity(bytes32 poolId, uint256[] calldata amountsIn)
        external
        override
        onlyPoolController(poolId)
    {
        Pool memory pool = pools[poolId];

        for (uint256 i = 0; i < pool.tokens.length; ++i) {
            address t = pool.tokens[i];
            uint256 bal = _balances[poolId][t];
            uint256 tokenAmountIn = amountsIn[i];
            require(tokenAmountIn != 0, "ERR_MATH_APPROX");
            require(
                bsub(
                    IERC20(t).balanceOf(address(this)),
                    _allocatedBalances[t]
                ) >= tokenAmountIn,
                "INSUFFICIENT UNALLOCATED BALANCE"
            );

            _balances[poolId][t] = badd(bal, tokenAmountIn);
            _allocatedBalances[t] = badd(_allocatedBalances[t], tokenAmountIn);
        }
    }

    function removeLiquidity(
        bytes32 poolId,
        address recipient,
        uint256[] calldata amountsOut
    ) external override onlyPoolController(poolId) {
        Pool memory pool = pools[poolId];

        for (uint256 i = 0; i < pool.tokens.length; ++i) {
            address t = pool.tokens[i];
            uint256 bal = _balances[poolId][t];
            uint256 tokenAmountOut = amountsOut[i];
            require(tokenAmountOut != 0, "ERR_MATH_APPROX");
            require(
                _allocatedBalances[t] >= tokenAmountOut,
                "INSUFFICIENT BALANCE TO WITHDRAW"
            );

            bool xfer = IERC20(t).transfer(recipient, tokenAmountOut);
            require(xfer, "ERR_ERC20_FALSE");

            _balances[poolId][t] = bsub(bal, tokenAmountOut);
            _allocatedBalances[t] = bsub(_allocatedBalances[t], tokenAmountOut);
        }
    }

    function getTokenAmountsIn(
        bytes32 poolId,
        uint256 ratio,
        uint256[] calldata maxAmountsIn
    ) external override view returns (uint256[] memory) {
        Pool memory pool = pools[poolId];
        require(
            pool.tokens.length == maxAmountsIn.length,
            "MAX AMOUNTS IN DOES NOT MATCH TOKENS LENGTH"
        );
        uint256[] memory tokenAmountsIn = new uint256[](pool.tokens.length);
        for (uint256 i = 0; i < pool.tokens.length; ++i) {
            address t = pool.tokens[i];
            uint256 bal = _balances[poolId][t];
            uint256 tokenAmountIn = bmul(ratio, bal);
            require(tokenAmountIn <= maxAmountsIn[i], "ERR_LIMIT_IN");
            tokenAmountsIn[i] = tokenAmountIn;
        }
        return tokenAmountsIn;
    }

    function getTokenAmountsOut(
        bytes32 poolId,
        uint256 ratio,
        uint256[] calldata minAmountsOut
    ) external override view returns (uint256[] memory) {
        Pool memory pool = pools[poolId];
        require(
            pool.tokens.length == minAmountsOut.length,
            "MAX AMOUNTS IN DOES NOT MATCH TOKENS LENGTH"
        );
        uint256[] memory tokenAmountsOut = new uint256[](pool.tokens.length);

        for (uint256 i = 0; i < pool.tokens.length; ++i) {
            address t = pool.tokens[i];
            uint256 bal = _balances[poolId][t];

            uint256 tokenAmountOut = bmul(ratio, bal);
            require(tokenAmountOut != 0, "ERR_MATH_APPROX");
            require(tokenAmountOut <= minAmountsOut[i], "ERR_LIMIT_OUT");

            tokenAmountsOut[i] = tokenAmountOut;
        }
        return tokenAmountsOut;
    }

    // 'Underlying' token-manipulation functions make external calls but are NOT locked
    // You must `_lock_` or otherwise ensure reentry-safety

    function _pullUnderlying(
        address erc20,
        address from,
        uint256 amount
    ) internal {
        bool xfer = IERC20(erc20).transferFrom(from, address(this), amount);
        require(xfer, "ERR_ERC20_FALSE");

        // TODO: What assumptions do we make when pulling? Should we check token.balanceOf(this)
        // increased by toPull?
        _tokenBalances[erc20] += amount;
    }

    function _pushUnderlying(
        address erc20,
        address to,
        uint256 amount
    ) internal {
        // TODO: What assumptions do we make when pushing? Should we check token.balanceOf(this)
        // decreased by toPull?
        _tokenBalances[erc20] -= amount;

        bool xfer = IERC20(erc20).transfer(to, amount);
        require(xfer, "ERR_ERC20_FALSE");
    }
}
