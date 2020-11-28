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

import "../math/FixedPoint.sol";

library PoolBalance {
    using FixedPoint for uint128;

    // This data structure is used to represent a token's balance for a Pool. 'cash' is how many tokens the Pool has
    // sitting inside of the Vault. 'total' is always larger or equal to 'cash', and represents the Pool's total token
    // balance, including tokens that are *not* inside of the Vault.
    //
    // Cash and total are updated in concordance whenever tokens are added/removed from a Pool, except when interacting
    // with the Pool's Investment Manager. The Investment Manager updates the new 'total' value (according to its own)
    // internal logic, which the Vault uses when validating swaps with the Pool's Trading Strategy, as well as returns
    // profits by returning invested 'cash'.
    //
    // The Vault disallows the Pool's 'cash' ever becoming negative, in other words, it can never use any tokens that
    // are not inside of the Vault.

    function cash(bytes32 balance) internal pure returns (uint128) {
        return uint128(uint256(balance)) & (2**(128) - 1);
    }

    /**
     * @dev The number of invested assets. This is simply the difference between 'total' and 'cash' - the Vault has no
     * insights into how the assets are used by the Investment Manager.
     */
    function invested(bytes32 balance) internal pure returns (uint128) {
        return uint128((uint256(balance) >> 128) & (2**(128) - 1));
    }

    function total(bytes32 balance) internal pure returns (uint128) {
        return cash(balance).add128(invested(balance));
    }

    function toBalance(uint128 cashBalance, uint128 investedBalance) internal pure returns (bytes32) {
        return bytes32((uint256(investedBalance) << 128) | cashBalance);
    }

    /**
     * @dev Increases a Pool's balance. Called when tokens are added to the Pool (except from the Investment Manager).
     */
    function increaseCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCash = cash(balance).add128(amount);
        uint128 newInvested = invested(balance);

        return toBalance(newCash, newInvested);
    }

    /**
     * @dev Decreases a Pool's balance. Called when tokens are removed from the Pool (except to the Investment Manager).
     */
    function decreaseCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCash = cash(balance).sub128(amount);
        uint128 newInvested = invested(balance);

        return toBalance(newCash, newInvested);
    }

    /**
     * @dev Increases a Pool's balance. Called when tokens are added to the Pool (except from the Investment Manager).
     */
    function cashToInvested(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCash = cash(balance).sub128(amount);
        uint128 newInvested = invested(balance).add128(amount);

        return toBalance(newCash, newInvested);
    }

    /**
     * @dev Decreases a Pool's balance. Called when tokens are removed from the Pool (except to the Investment Manager).
     */
    function investedToCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCash = cash(balance).add128(amount);
        uint128 newInvested = invested(balance).sub128(amount);

        return toBalance(newCash, newInvested);
    }

    function setInvested(bytes32 balance, uint128 newInvested) internal pure returns (bytes32) {
        uint128 newCash = cash(balance);

        return toBalance(newCash, newInvested);
    }
}
