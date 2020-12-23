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

// Imports

import "../vault/IVault.sol";

// Interfaces

/**
 * @title Pool interface that represents holding BTokens (BPTs)
 * @dev Optional - pools are not required to implement this interface
 * @author Balancer Labs
 */
interface IBPTPool {
    
    // Function delcarations

    // External functions

    /**
     * @notice Getter for the core Vault contract
     * @return interface to the Vault
     */
    function getVault() external view returns (IVault);

    /**
     * @notice Getter for the Pool ID
     * @return Pool ID
     */
    function getPoolId() external view returns (bytes32);

    /**
     * @notice Add Liquidity to a pool
     * @dev The set of tokens is not specified because it is read from the Vault - and remains immutable.
     *      Users who contribute tokens to pools are known as Liquidity Providers - they are enabling other users
     *      to trade constituent tokens between this pool and others; the more tokens users contribute, the more
     *      "liquid" the supply of that token, and the lower the "slippage" (i.e., the price changes resulting from
     *      changing trading balances).
     *
     *      "Joining" a pool means exchanging constituent tokens for Balancer Pool Tokens (BPTs), which represent
     *      shares in the pool. These are standard ERC20 tokens that can be traded, placed in other pools, or
     *      burned to recover a proportional share of the constituent tokens (see "exitPool" below).
     *
     *      To join a pool, LPs must provide all constituent pool tokens, proportional to their current balances.
     *      For instance, if the total supply is 100, supplying 10% of the current balances of all tokens will
     *      mint 10 BPTs, and increase the total supply to 110.
     *
     *      Pools may charge swap fees on every exchange, and if they do so, those fees slightly increase the
     *      balances of all incoming tokens, which proportionally raises the value of all pool tokens held by LPs.
     *
     * @param poolAmountOut - how much BPT the user expects to get
     * @param maxAmountsIn - the max price the user is willing to pay for the given amount of BPTs.
     *                       This is necessary because the totalSupply or composition of the pool might change
     *                       before the transaction is mined, with adverse effects on the price
     * @param transferTokens - whether or not tokens are transferred (vs taken from User Balance)
     * @param beneficiary - destination of the BPT tokens
     */
    function joinPool(
        uint256 poolAmountOut,
        uint128[] calldata maxAmountsIn,
        bool transferTokens,
        address beneficiary
    ) external;

    /**
     * @notice Remove Liquidity from a pool
     * @dev The set of tokens is not specified because it is read from the Vault - and remains immutable.
     *      The BPTs can be returned to the Pool at any time by calling exitPool. If the user has 10 BPTs, and
     *      the current totalSupply is 1000, they will receive 1% of the balances of all constituent tokens at
     *      the time of withdrawal, in exchange for burning their BPTs. The totalSupply would then decrease to 990.
     *
     *      Note that if the pool charges swap fees, the balances of incoming tokens will increase over time,
     *      so that ideally LPs would withdraw more than they put in, as a proportional reward for providing liquidity.
     *      However, a user exiting a pool will receive tokens according to the current proportions of the pool 
     *      constituents, regardless of what they were on entry. (This can result in impermanent loss.)
     *
     * @param poolAmountIn - how much BPT the user is supplying (burning)
     * @param minAmountsOut - the minimum amount of pool tokens the user will accept in exchange for the BPTs
     *                        This is necessary because the totalSupply or composition of the pool might change
     *                        before the transaction is mined, with adverse effects on the price
     * @param withdrawTokens - whether or not tokens are transferred out of the vault (vs added to User Balance)
     * @param beneficiary - destination of the constituent tokens
     */
    function exitPool(
        uint256 poolAmountIn,
        uint256[] calldata minAmountsOut,
        bool withdrawTokens,
        address beneficiary
    ) external;
}
