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
 * @title Essential Pool interface
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
     * @notice Getter for the encoded Pool ID
     * @return encoded Pool ID
     */
    function getPoolId() external view returns (bytes32);

    /**
     * @notice Add Liquidity to a pool
     * @dev The set of tokens is not specified because it is read from the Vault - and remains immutable
     * @param poolAmountOut - how much BPT the user expects to get
     * @param maxAmountsIn - the max amounts of each token the user is willing to add to the vault
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
     * @dev The set of tokens is not specified because it is read from the Vault - and remains immutable
     * @param poolAmountIn - how much BPT the user is supplying (burning)
     * @param minAmountsOut - the max amounts of each token the user is willing to withdraw from the vault
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
