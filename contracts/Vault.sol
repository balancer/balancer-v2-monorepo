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
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "@nomiclabs/buidler/console.sol";

import "./PoolRegistry.sol";

import "./ISwapCaller.sol";

import "./LogExpMath.sol";
import "./curves/ICurve.sol";

contract Vault is IVault, PoolRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    // The vault's accounted-for balance for each token. These include:
    //  * tokens in pools
    //  * tokens stored as user balance
    mapping(address => uint256) private _vaultTokenBalance; // token -> vault balance

    mapping(address => mapping(address => uint256)) private _userTokenBalance; // user -> token -> user balance
    // operators are allowed to use a user's tokens in a swap
    mapping(address => EnumerableSet.AddressSet) private _userOperators;

    event Deposited(
        address indexed depositor,
        address indexed user,
        address indexed token,
        uint256 amount
    );

    event Withdrawn(
        address indexed user,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    event AuthorizedOperator(address indexed user, address indexed operator);
    event RevokedOperator(address indexed user, address indexed operator);

    function getUserTokenBalance(address user, address token)
        public
        view
        returns (uint256)
    {
        return _userTokenBalance[user][token];
    }

    function deposit(
        address token,
        uint256 amount,
        address user
    ) external {
        // TODO: check overflow
        _userTokenBalance[user][token] += amount;

        // TODO: use ISwapCaller callback?
        _pullUnderlying(token, msg.sender, amount);

        emit Deposited(msg.sender, user, token, amount);
    }

    function withdraw(
        address token,
        uint256 amount,
        address recipient
    ) external {
        require(
            _userTokenBalance[msg.sender][token] >= amount,
            "Vault: withdraw amount exceeds balance"
        );

        _userTokenBalance[msg.sender][token] -= amount;

        _pushUnderlying(token, recipient, amount);

        emit Withdrawn(msg.sender, recipient, token, amount);
    }

    function authorizeOperator(address operator) external {
        if (_userOperators[msg.sender].add(operator)) {
            emit AuthorizedOperator(msg.sender, operator);
        }
    }

    function revokeOperator(address operator) external {
        if (_userOperators[msg.sender].remove(operator)) {
            emit RevokedOperator(msg.sender, operator);
        }
    }

    function isOperatorFor(address user, address operator)
        public
        view
        returns (bool)
    {
        return (user == operator) || _userOperators[user].contains(operator);
    }

    function getUserTotalOperators(address user)
        external
        view
        returns (uint256)
    {
        return _userOperators[user].length();
    }

    function getUserOperators(
        address user,
        uint256 start,
        uint256 end
    ) external view returns (address[] memory) {
        // Ideally we'd use a native implemenation: see
        // https://github.com/OpenZeppelin/openzeppelin-contracts/issues/2390
        address[] memory operators = new address[](
            _userOperators[user].length()
        );

        for (uint256 i = start; i < end; ++i) {
            operators[i] = _userOperators[user].at(i);
        }

        return operators;
    }

    // Bind does not lock because it jumps to `rebind`, which does
    function bind(
        bytes32 poolId,
        address token,
        uint256 balance
    ) external override _logs_ {
        require(msg.sender == pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(!poolRecords[poolId][token].bound, "ERR_IS_BOUND");

        require(
            pools[poolId].tokens.length < MAX_BOUND_TOKENS,
            "ERR_MAX_TOKENS"
        );

        poolRecords[poolId][token] = Record({
            bound: true,
            index: uint8(pools[poolId].tokens.length)
        });
        pools[poolId].tokens.push(token);
        rebind(poolId, token, balance);
    }

    function rebind(
        bytes32 poolId,
        address token,
        uint256 balance
    ) public override _logs_ _lock_ {
        require(msg.sender == pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(poolRecords[poolId][token].bound, "ERR_NOT_BOUND");

        require(balance >= MIN_BALANCE, "ERR_MIN_BALANCE");


        // Adjust the balance record and actual token balance
        uint256 oldBalance = _poolTokenBalance[poolId][token];
        _poolTokenBalance[poolId][token] = balance;

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

        uint256 tokenBalance = _poolTokenBalance[poolId][token];

        // Swap the token-to-unbind with the last token,
        // then delete the last token
        uint8 index = poolRecords[poolId][token].index;
        uint last = pools[poolId].tokens.length - 1;
        pools[poolId].tokens[index] = pools[poolId].tokens[last];
        poolRecords[poolId][pools[poolId].tokens[index]].index = index;
        pools[poolId].tokens.pop();
        poolRecords[poolId][token] = Record({
            bound: false,
            index: 0
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
        uint256 inRecordBalance = _poolTokenBalance[poolId][tokenIn];
        Record storage outRecord = poolRecords[poolId][tokenOut];
        uint256 outRecordBalance = _poolTokenBalance[poolId][tokenOut];
        ICurve inv = ICurve(pools[poolId].invariant);
        uint256 swapFee = pools[poolId].swapFee;

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        return
            inv.spotPrice(
                inRecord.index,
                outRecord.index,
                inRecordBalance,
                outRecordBalance,
                swapFee
            );
    }

    function getSpotPriceSansFee(
        bytes32 poolId,
        address tokenIn,
        address tokenOut
    ) external override view _viewlock_ returns (uint256 spotPrice) {
        Record storage inRecord = poolRecords[poolId][tokenIn];
        uint256 inRecordBalance = _poolTokenBalance[poolId][tokenIn];
        Record storage outRecord = poolRecords[poolId][tokenOut];
        uint256 outRecordBalance = _poolTokenBalance[poolId][tokenOut];
        ICurve inv = ICurve(pools[poolId].invariant);

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        return
            inv.spotPrice(
                inRecord.index,
                outRecord.index,
                inRecordBalance,
                outRecordBalance,
                0
            );
    }

    function batchSwap(
        Diff[] memory diffs,
        Swap[] memory swaps,
        FundsIn calldata fundsIn,
        FundsOut calldata fundsOut
    ) external override {
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

            // 1.1.a: Validate hints and new balance for token A

            address tokenA = diffs[swap.tokenA.tokenDiffIndex].token;

            Record memory recordA = poolRecords[swap.poolId][tokenA];
            uint256 poolTokenABalance = _poolTokenBalance[swap.poolId][tokenA];

            // Validate Pool has Token A and diff index is correct
            require(poolTokenABalance > 0, "Token A not in pool");
            // Validate swap alters pool's balance for token A
            require(swap.tokenA.delta != 0, "Token A NOOP");

            // 1.1.b: Validate hints and new balance for token B

            address tokenB = diffs[swap.tokenB.tokenDiffIndex].token;

            Record memory recordB = poolRecords[swap.poolId][tokenB];
            uint256 poolTokenBBalance = _poolTokenBalance[swap.poolId][tokenB];

            // Validate Pool has Token B and diff index is correct
            require(poolTokenBBalance > 0, "Token B not in pool");
            // Validate swap alters pool's balance for token B
            require(swap.tokenB.delta != 0, "Token B NOOP");

            // 1.2: Accumulate token diffs
            diffs[swap.tokenA.tokenDiffIndex].vaultDelta += swap.tokenA.delta;
            diffs[swap.tokenB.tokenDiffIndex].vaultDelta += swap.tokenB.delta;

            // 2: Check new balances are valid without considering fee.
            // Fees are always charged from tokenA regardless if is a token entering or exiting the pool.

            // TODO: check overflow (https://docs.openzeppelin.com/contracts/3.x/api/utils#SafeCast-toInt256-uint256-)
            // Also maybe handle int-uint arithmetic more concisely

            uint256 poolTokenABalanceNew = swap.tokenA.delta > 0
                ? badd(poolTokenABalance, uint256(swap.tokenA.delta))
                : bsub(poolTokenABalance, uint256(-swap.tokenA.delta));

            uint256 poolTokenBBalanceNew = swap.tokenB.delta > 0
                ? badd(poolTokenBBalance, uint256(swap.tokenB.delta))
                : bsub(poolTokenBBalance, uint256(-swap.tokenB.delta));

            uint256 tokenABalanceMinusFee = (swap.tokenA.delta > 0)
                ? badd(
                    poolTokenABalance,
                    bmul(uint256(swap.tokenA.delta), bsub(BONE, pool.swapFee))
                )
                : bsub(
                    poolTokenABalance,
                    bmul(uint256(-swap.tokenA.delta), bsub(BONE, pool.swapFee))
                );

            {
              uint256[] memory oldBalances = new uint256[](pool.tokens.length);
              uint256[] memory newBalances = new uint256[](pool.tokens.length);

              (oldBalances, newBalances) = balancesOldNew(
                pool,
                swap.poolId,
                tokenA,
                tokenB,
                tokenABalanceMinusFee,
                poolTokenBBalanceNew
              );
              ICurve inv = ICurve(pools[swap.poolId].invariant);
              require(inv.validateBalances(oldBalances, newBalances));
            }

            // 3: update pool balances
            _poolTokenBalance[swap.poolId][tokenA] = poolTokenABalanceNew;
            _poolTokenBalance[swap.poolId][tokenB] = poolTokenBBalanceNew;
        }

        // Step 4: measure current balance for tokens that need to be received
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta > 0) {
                // Change positive deltas into expected final balances
                diff.vaultDelta += int256(
                    IERC20(diff.token).balanceOf(address(this))
                ); // TODO: check overflows
            }
        }

        // Call into sender to trigger token receipt
        ISwapCaller(msg.sender).sendTokens(fundsIn.callbackData);

        // Step 5: check tokens have been received
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta > 0) {
                uint256 newBalance = IERC20(diff.token).balanceOf(
                    address(this)
                );

                if (uint256(diff.vaultDelta) > newBalance) {
                    uint256 missing = uint256(diff.vaultDelta) - newBalance;

                    require(
                        isOperatorFor(fundsIn.withdrawFrom, msg.sender),
                        "Caller is not operator"
                    );
                    require(
                        _userTokenBalance[fundsIn.withdrawFrom][diff.token] >=
                            missing,
                        "ERR_INVALID_DEPOSIT"
                    );

                    _userTokenBalance[fundsIn.withdrawFrom][diff
                        .token] -= missing;
                }

                // Update token balance
                // TODO: only update based on how many tokens were received
                _vaultTokenBalance[diff.token] = newBalance;
            }
        }

        // Step 6: send out tokens to send
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta < 0) {
                // Make delta positive
                uint256 amount = uint256(-diff.vaultDelta);

                if (fundsOut.transferToRecipient) {
                    // Actually transfer the tokens to the recipient
                    _pushUnderlying(diff.token, fundsOut.recipient, amount);
                } else {
                    // Allocate tokens to the recipient as user balance - the vault's balance doesn't change
                    _userTokenBalance[fundsOut.recipient][diff.token] = badd(
                        _userTokenBalance[fundsOut.recipient][diff.token],
                        amount
                    );
                }
            }
        }
    }

    function balancesOldNew(
      Pool storage pool,
      bytes32 poolId,
      address tokenA,
      address tokenB,
      uint256 poolTokenABalanceNew,
      uint256 poolTokenBBalanceNew
    ) internal returns (uint256[] memory oldBalances, uint256[] memory newBalances)
    {
      uint256[] memory oldBalances = new uint256[](pool.tokens.length);
      uint256[] memory newBalances = new uint256[](pool.tokens.length);
      for (uint256 j = 0; j < pool.tokens.length; j++) {
        address t = pool.tokens[j];

        oldBalances[j] = _poolTokenBalance[poolId][t];
        if (tokenA == t) {
          newBalances[j] = poolTokenABalanceNew;
        } else if (tokenB == t) {
          newBalances[j] = poolTokenBBalanceNew;
        } else {
          newBalances[j] = oldBalances[j];
        }
      }
      return (oldBalances, newBalances);
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

            _poolTokenBalance[poolId][t] = tokenAmountIn;
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
            uint256 bal = _poolTokenBalance[poolId][t];
            uint256 tokenAmountIn = amountsIn[i];
            require(tokenAmountIn != 0, "ERR_MATH_APPROX");
            require(
                bsub(
                    IERC20(t).balanceOf(address(this)),
                    _allocatedBalances[t]
                ) >= tokenAmountIn,
                "INSUFFICIENT UNALLOCATED BALANCE"
            );

            _poolTokenBalance[poolId][t] = badd(bal, tokenAmountIn);
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
            uint256 bal = _poolTokenBalance[poolId][t];
            uint256 tokenAmountOut = amountsOut[i];
            require(tokenAmountOut != 0, "ERR_MATH_APPROX");
            require(
                _allocatedBalances[t] >= tokenAmountOut,
                "INSUFFICIENT BALANCE TO WITHDRAW"
            );

            bool xfer = IERC20(t).transfer(recipient, tokenAmountOut);
            require(xfer, "ERR_ERC20_FALSE");

            _poolTokenBalance[poolId][t] = bsub(bal, tokenAmountOut);
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
            uint256 bal = _poolTokenBalance[poolId][t];
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
            uint256 bal = _poolTokenBalance[poolId][t];

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
        _vaultTokenBalance[erc20] += amount;
    }

    function _pushUnderlying(
        address erc20,
        address to,
        uint256 amount
    ) internal {
        // TODO: What assumptions do we make when pushing? Should we check token.balanceOf(this)
        // decreased by toPull?
        _vaultTokenBalance[erc20] -= amount;

        bool xfer = IERC20(erc20).transfer(to, amount);
        require(xfer, "ERR_ERC20_FALSE");
    }
}
