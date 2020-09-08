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
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@nomiclabs/buidler/console.sol";

import "./PoolRegistry.sol";
import "./IVault.sol";

import "./LogExpMath.sol";

contract Vault is IVault, PoolRegistry {
    mapping (address => uint256) private _tokenBalances;

    // Bind does not lock because it jumps to `rebind`, which does
    function bind(uint256 poolId, address token, uint balance, uint denorm) external _logs_ {
        require(msg.sender == _pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(!_pools[poolId].records[token].bound, "ERR_IS_BOUND");

        require(_pools[poolId].tokens.length < MAX_BOUND_TOKENS, "ERR_MAX_TOKENS");

        _pools[poolId].records[token] = Record({
            bound: true,
            index: _pools[poolId].tokens.length,
            denorm: 0,    // balance and denorm will be validated
            balance: 0    // and set by `rebind`
        });
        _pools[poolId].tokens.push(token);
        rebind(poolId, token, balance, denorm);
    }

    function rebind(uint256 poolId, address token, uint balance, uint denorm) public _logs_ _lock_ {
        require(msg.sender == _pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(_pools[poolId].records[token].bound, "ERR_NOT_BOUND");

        require(denorm >= MIN_WEIGHT, "ERR_MIN_WEIGHT");
        require(denorm <= MAX_WEIGHT, "ERR_MAX_WEIGHT");
        require(balance >= MIN_BALANCE, "ERR_MIN_BALANCE");

        // Adjust the denorm and totalWeight
        uint oldWeight = _pools[poolId].records[token].denorm;
        if (denorm > oldWeight) {
            _pools[poolId].totalWeight = badd(_pools[poolId].totalWeight, bsub(denorm, oldWeight));
            require(_pools[poolId].totalWeight <= MAX_TOTAL_WEIGHT, "ERR_MAX_TOTAL_WEIGHT");
        } else if (denorm < oldWeight) {
            _pools[poolId].totalWeight = bsub(_pools[poolId].totalWeight, bsub(oldWeight, denorm));
        }
        _pools[poolId].records[token].denorm = denorm;

        // Adjust the balance record and actual token balance
        uint oldBalance = _pools[poolId].records[token].balance;
        _pools[poolId].records[token].balance = balance;

        if (balance > oldBalance) {
            _pullUnderlying(token, msg.sender, bsub(balance, oldBalance));
        } else if (balance < oldBalance) {
            // TODO: charge exit fee
            _pushUnderlying(token, msg.sender, bsub(oldBalance, balance));
        }
    }

    function unbind(uint256 poolId, address token) external _logs_ _lock_ {
        require(msg.sender == _pools[poolId].controller, "ERR_NOT_CONTROLLER");
        require(_pools[poolId].records[token].bound, "ERR_NOT_BOUND");

        uint tokenBalance = _pools[poolId].records[token].balance;

        _pools[poolId].totalWeight = bsub(_pools[poolId].totalWeight, _pools[poolId].records[token].denorm);

        // Swap the token-to-unbind with the last token,
        // then delete the last token
        uint index = _pools[poolId].records[token].index;
        uint last = _pools[poolId].tokens.length - 1;
        _pools[poolId].tokens[index] = _pools[poolId].tokens[last];
        _pools[poolId].records[_pools[poolId].tokens[index]].index = index;
        _pools[poolId].tokens.pop();
        _pools[poolId].records[token] = Record({
            bound: false,
            index: 0,
            denorm: 0,
            balance: 0
        });

        // TODO: charge exit fee
        _pushUnderlying(token, msg.sender, tokenBalance);
    }

    function getSpotPrice(uint256 poolId, address tokenIn, address tokenOut) external view _viewlock_ returns (uint spotPrice) {
        Record storage inRecord = _pools[poolId].records[tokenIn];
        Record storage outRecord = _pools[poolId].records[tokenOut];

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        return calcSpotPrice(inRecord.balance, inRecord.denorm, outRecord.balance, outRecord.denorm, _pools[poolId].swapFee);
    }

    function getSpotPriceSansFee(uint256 poolId, address tokenIn, address tokenOut) external view _viewlock_ returns (uint spotPrice) {
        Record storage inRecord = _pools[poolId].records[tokenIn];
        Record storage outRecord = _pools[poolId].records[tokenOut];

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        return calcSpotPrice(inRecord.balance, inRecord.denorm, outRecord.balance, outRecord.denorm, 0);
    }

    struct Diff {
        address token;
        int256 vaultDelta; // Positive delta means the vault receives tokens
    }

    struct TokenState {
        uint256 tokenPoolIndex;
        uint256 tokenDiffIndex;
        uint256 balance;
    }

    struct Swaps {
        uint256 poolId;

        TokenState tokenA;
        TokenState tokenB;
    }

    function batchSwap(Diff[] memory diffs, Swaps[] memory swaps) public {
        // TODO: check tokens in diffs are unique. Is this necessary? Would avoid multiple valid diff
        // indexes pointing to the same token.
        // A simple way to implement this is to require the addresses to be sorted, and require strict
        // inequality

        for (uint256 i = 0; i < diffs.length; ++i) {
            require(diffs[i].vaultDelta == 0, "Bad workspace");
        }

        // TODO: check each pool only appears in a single swap. Might be overly restrictive, but easy
        // to implement (require swaps array to be sorted by poolId).

        // Steps 1 & 2:
        //  - validate hints
        //  - check new pool balances are valid
        //  - accumulate token diffs
        //  - update pool balances

        for (uint256 i = 0; i < swaps.length; ++i) {
            Swaps memory swap = swaps[i];
            Pool storage pool = _pools[swap.poolId];

            // TODO: account for swap fees

            // 1.1.a: Validate hints and new balance for token A

            // Validate Pool has Token A and diff index is correct
            address tokenA = diffs[swap.tokenA.tokenDiffIndex].token;

            require(pool.tokens[swap.tokenA.tokenPoolIndex] == tokenA, "Bad token A index hint");
            Record memory recordA = pool.records[tokenA];

            // Validate swap alters pool's balance for token A
            require(swap.tokenA.balance != recordA.balance, "NOOP");

            // 1.1.b: Validate hints and new balance for token B

            // Validate Pool has Token B and diff index is correct
            address tokenB = diffs[swap.tokenB.tokenDiffIndex].token;

            require(pool.tokens[swap.tokenB.tokenPoolIndex] == tokenB, "Bad token B index hint");
            Record memory recordB = pool.records[tokenB];

            // Validate swap alters pool's balance for token B
            require(swap.tokenB.balance != recordB.balance, "NOOP");

            // 1.2: Validate new balances are valid

            require(validateBalances(recordA.balance, recordB.balance, swap.tokenA.balance, swap.tokenB.balance, recordA.denorm, recordB.denorm), "ERR_INVALID_SWAP");

            // 2: Accumulate token diffs

            int256 balanceADelta = int256(swap.tokenA.balance - recordA.balance); // TODO: check overflow
            diffs[swap.tokenA.tokenDiffIndex].vaultDelta += balanceADelta;

            int256 balanceBDelta = int256(swap.tokenB.balance - recordB.balance); // TODO: check overflow
            diffs[swap.tokenB.tokenDiffIndex].vaultDelta += balanceBDelta;
        }

        // Step 3: check tokens have been received

        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta > 0) {
                uint256 newBalance = IERC20(diff.token).balanceOf(address(this));

                // TODO: check strict equality? Might not be feasible due to approximations
                require(newBalance >= badd(_tokenBalances[diff.token], uint256(diff.vaultDelta)), "ERR_INVALID_DEPOSIT");

                // Update token balance
                _tokenBalances[diff.token] = newBalance;
            }
        }

        // Step 4: send out tokens to send

        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta < 0) {
                // Make delta positive
                uint256 amount = uint256(-diff.vaultDelta);

                _pushUnderlying(diff.token, msg.sender, amount);
            }
        }
    }

    function validateBalances(uint256 oldBalanceA, uint256 oldBalanceB, uint256 newBalanceA, uint256 newBalanceB, uint256 denormA, uint256 denormB) private pure returns (bool) {
        require(newBalanceA > 0 && newBalanceB > 0, "ERR_INVALID_BALANCE"); //Balances should never be zero

        uint256 oldValue = bmul(
            uint256(LogExpMath.exp(int256(oldBalanceA), int256(denormA))),
            uint256(LogExpMath.exp(int256(oldBalanceB), int256(denormB)))
        );

        uint256 newValue = bmul(
            uint256(LogExpMath.exp(int256(newBalanceA), int256(denormA))),
            uint256(LogExpMath.exp(int256(newBalanceB), int256(denormB)))
        );

        // Require value to remain or increase, even if this means the trader is not being optimal
        return newValue >= oldValue;
    }

    // 'Underlying' token-manipulation functions make external calls but are NOT locked
    // You must `_lock_` or otherwise ensure reentry-safety

    function _pullUnderlying(address erc20, address from, uint amount) internal {
        bool xfer = IERC20(erc20).transferFrom(from, address(this), amount);
        require(xfer, "ERR_ERC20_FALSE");

        // TODO: What assumptions do we make when pulling? Should we check token.balanceOf(this)
        // increased by toPull?
        _tokenBalances[erc20] += amount;
    }

    function _pushUnderlying(address erc20, address to, uint amount) internal {
        bool xfer = IERC20(erc20).transfer(to, amount);
        require(xfer, "ERR_ERC20_FALSE");

        // TODO: What assumptions do we make when pushing? Should we check token.balanceOf(this)
        // decreased by toPull?
        _tokenBalances[erc20] -= amount;
    }
}
