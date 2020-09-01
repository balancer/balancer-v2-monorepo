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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./PoolRegistry.sol";

contract Vault is PoolRegistry {
    // Bind does not lock because it jumps to `rebind`, which does
    function bind(uint256 poolId, address token, uint balance, uint denorm) external _logs_ {
        require(msg.sender == _pools[poolId]._controller, "ERR_NOT_CONTROLLER");
        require(!_pools[poolId]._records[token].bound, "ERR_IS_BOUND");

        require(_pools[poolId]._tokens.length < MAX_BOUND_TOKENS, "ERR_MAX_TOKENS");

        _pools[poolId]._records[token] = Record({
            bound: true,
            index: _pools[poolId]._tokens.length,
            denorm: 0,    // balance and denorm will be validated
            balance: 0   // and set by `rebind`
        });
        _pools[poolId]._tokens.push(token);
        rebind(poolId, token, balance, denorm);
    }

    function rebind(uint256 poolId, address token, uint balance, uint denorm) public _logs_ _lock_ {
        require(msg.sender == _pools[poolId]._controller, "ERR_NOT_CONTROLLER");
        require(_pools[poolId]._records[token].bound, "ERR_NOT_BOUND");

        require(denorm >= MIN_WEIGHT, "ERR_MIN_WEIGHT");
        require(denorm <= MAX_WEIGHT, "ERR_MAX_WEIGHT");
        require(balance >= MIN_BALANCE, "ERR_MIN_BALANCE");

        // Adjust the denorm and totalWeight
        uint oldWeight = _pools[poolId]._records[token].denorm;
        if (denorm > oldWeight) {
            _pools[poolId]._totalWeight = badd(_pools[poolId]._totalWeight, bsub(denorm, oldWeight));
            require(_pools[poolId]._totalWeight <= MAX_TOTAL_WEIGHT, "ERR_MAX_TOTAL_WEIGHT");
        } else if (denorm < oldWeight) {
            _pools[poolId]._totalWeight = bsub(_pools[poolId]._totalWeight, bsub(oldWeight, denorm));
        }
        _pools[poolId]._records[token].denorm = denorm;

        // Adjust the balance record and actual token balance
        uint oldBalance = _pools[poolId]._records[token].balance;
        _pools[poolId]._records[token].balance = balance;

        // TODO: charge exit fee if applicable (i.e. if balance < oldBalance)
        _pullUnderlying(token, msg.sender, bsub(balance, oldBalance));
    }

    function unbind(uint256 poolId, address token) external _logs_ _lock_ {
        require(msg.sender == _pools[poolId]._controller, "ERR_NOT_CONTROLLER");
        require(_pools[poolId]._records[token].bound, "ERR_NOT_BOUND");

        uint tokenBalance = _pools[poolId]._records[token].balance;
        uint tokenExitFee = bmul(tokenBalance, EXIT_FEE);

        _pools[poolId]._totalWeight = bsub(_pools[poolId]._totalWeight, _pools[poolId]._records[token].denorm);

        // Swap the token-to-unbind with the last token,
        // then delete the last token
        uint index = _pools[poolId]._records[token].index;
        uint last = _pools[poolId]._tokens.length - 1;
        _pools[poolId]._tokens[index] = _pools[poolId]._tokens[last];
        _pools[poolId]._records[_pools[poolId]._tokens[index]].index = index;
        _pools[poolId]._tokens.pop();
        _pools[poolId]._records[token] = Record({
            bound: false,
            index: 0,
            denorm: 0,
            balance: 0
        });

        // TODO: charge exit fee
        _pushUnderlying(token, msg.sender, tokenBalance);
    }

    function getSpotPrice(uint256 poolId, address tokenIn, address tokenOut) external view _viewlock_ returns (uint spotPrice) {
        Record storage inRecord = _pools[poolId]._records[tokenIn];
        Record storage outRecord = _pools[poolId]._records[tokenOut];

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        return calcSpotPrice(inRecord.balance, inRecord.denorm, outRecord.balance, outRecord.denorm, _pools[poolId]._swapFee);
    }

    function getSpotPriceSansFee(uint256 poolId, address tokenIn, address tokenOut) external view _viewlock_ returns (uint spotPrice) {
        Record storage inRecord = _pools[poolId]._records[tokenIn];
        Record storage outRecord = _pools[poolId]._records[tokenOut];

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        return calcSpotPrice(inRecord.balance, inRecord.denorm, outRecord.balance, outRecord.denorm, 0);
    }

    function swapExactAmountIn(
        uint256 poolId,
        address tokenIn,
        uint tokenAmountIn,
        address tokenOut,
        uint minAmountOut,
        uint maxPrice
    )
        external
        _logs_
        _lock_
        returns (uint tokenAmountOut, uint spotPriceAfter)
    {
        require(_pools[poolId]._paused, "ERR_SWAP_NOT_PUBLIC");

        Record storage inRecord = _pools[poolId]._records[address(tokenIn)];
        Record storage outRecord = _pools[poolId]._records[address(tokenOut)];

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        require(tokenAmountIn <= bmul(inRecord.balance, MAX_IN_RATIO), "ERR_MAX_IN_RATIO");

        uint spotPriceBefore = calcSpotPrice(
                                    inRecord.balance,
                                    inRecord.denorm,
                                    outRecord.balance,
                                    outRecord.denorm,
                                    _pools[poolId]._swapFee
                                );
        require(spotPriceBefore <= maxPrice, "ERR_BAD_LIMIT_PRICE");

        tokenAmountOut = calcOutGivenIn(
                            inRecord.balance,
                            inRecord.denorm,
                            outRecord.balance,
                            outRecord.denorm,
                            tokenAmountIn,
                            _pools[poolId]._swapFee
                        );
        require(tokenAmountOut >= minAmountOut, "ERR_LIMIT_OUT");

        inRecord.balance = badd(inRecord.balance, tokenAmountIn);
        outRecord.balance = bsub(outRecord.balance, tokenAmountOut);

        spotPriceAfter = calcSpotPrice(
                                inRecord.balance,
                                inRecord.denorm,
                                outRecord.balance,
                                outRecord.denorm,
                                _pools[poolId]._swapFee
                            );
        require(spotPriceAfter >= spotPriceBefore, "ERR_MATH_APPROX");
        require(spotPriceAfter <= maxPrice, "ERR_LIMIT_PRICE");
        require(spotPriceBefore <= bdiv(tokenAmountIn, tokenAmountOut), "ERR_MATH_APPROX");

        emit LOG_SWAP(msg.sender, tokenIn, tokenOut, tokenAmountIn, tokenAmountOut);

        _pullUnderlying(tokenIn, msg.sender, tokenAmountIn);
        _pushUnderlying(tokenOut, msg.sender, tokenAmountOut);

        return (tokenAmountOut, spotPriceAfter);
    }

    function swapExactAmountOut(
        uint256 poolId,
        address tokenIn,
        uint maxAmountIn,
        address tokenOut,
        uint tokenAmountOut,
        uint maxPrice
    )
        external
        _logs_
        _lock_
        returns (uint tokenAmountIn, uint spotPriceAfter)
    {
        require(_pools[poolId]._paused, "ERR_SWAP_NOT_PUBLIC");

        Record storage inRecord = _pools[poolId]._records[address(tokenIn)];
        Record storage outRecord = _pools[poolId]._records[address(tokenOut)];

        require(inRecord.bound, "ERR_NOT_BOUND");
        require(outRecord.bound, "ERR_NOT_BOUND");

        require(tokenAmountOut <= bmul(outRecord.balance, MAX_OUT_RATIO), "ERR_MAX_OUT_RATIO");

        uint spotPriceBefore = calcSpotPrice(
                                    inRecord.balance,
                                    inRecord.denorm,
                                    outRecord.balance,
                                    outRecord.denorm,
                                    _pools[poolId]._swapFee
                                );
        require(spotPriceBefore <= maxPrice, "ERR_BAD_LIMIT_PRICE");

        tokenAmountIn = calcInGivenOut(
                            inRecord.balance,
                            inRecord.denorm,
                            outRecord.balance,
                            outRecord.denorm,
                            tokenAmountOut,
                            _pools[poolId]._swapFee
                        );
        require(tokenAmountIn <= maxAmountIn, "ERR_LIMIT_IN");

        inRecord.balance = badd(inRecord.balance, tokenAmountIn);
        outRecord.balance = bsub(outRecord.balance, tokenAmountOut);

        spotPriceAfter = calcSpotPrice(
                                inRecord.balance,
                                inRecord.denorm,
                                outRecord.balance,
                                outRecord.denorm,
                                _pools[poolId]._swapFee
                            );
        require(spotPriceAfter >= spotPriceBefore, "ERR_MATH_APPROX");
        require(spotPriceAfter <= maxPrice, "ERR_LIMIT_PRICE");
        require(spotPriceBefore <= bdiv(tokenAmountIn, tokenAmountOut), "ERR_MATH_APPROX");

        emit LOG_SWAP(msg.sender, tokenIn, tokenOut, tokenAmountIn, tokenAmountOut);

        _pullUnderlying(tokenIn, msg.sender, tokenAmountIn);
        _pushUnderlying(tokenOut, msg.sender, tokenAmountOut);

        return (tokenAmountIn, spotPriceAfter);
    }

    // 'Underlying' token-manipulation functions make external calls but are NOT locked
    // You must `_lock_` or otherwise ensure reentry-safety

    function _pullUnderlying(address erc20, address from, uint amount) internal {
        bool xfer = IERC20(erc20).transferFrom(from, address(this), amount);
        require(xfer, "ERR_ERC20_FALSE");
    }

    function _pushUnderlying(address erc20, address to, uint amount) internal {
        bool xfer = IERC20(erc20).transfer(to, amount);
        require(xfer, "ERR_ERC20_FALSE");
    }
}
