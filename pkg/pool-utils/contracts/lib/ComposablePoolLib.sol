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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

// solhint-disable no-inline-assembly

library ComposablePoolLib {
    using FixedPoint for uint256;

    /**
     * @notice Returns a slice of the original array, with the BPT token address removed.
     * @dev *This mutates the original array*, which should not be used anymore after calling this function.
     * It's recommended to call this function such that the calling function either immediately returns or overwrites
     * the original array variable so it cannot be accessed.
     */
    function dropBptFromTokens(IERC20[] memory registeredTokens) internal pure returns (IERC20[] memory tokens) {
        assembly {
            // An array's memory representation is a 32 byte word for the length followed by 32 byte words for
            // each element, with the stack variable pointing to the length. Since there's no memory deallocation,
            // and we are free to mutate the received array, the cheapest way to remove the first element is to
            // create a new subarray by overwriting the first element with a reduced length, and moving the pointer
            // forward to that position.
            //
            // Original:
            // [ length ] [ data[0] ] [ data[1] ] [ ... ]
            // ^ pointer
            //
            // Modified:
            // [ length ] [ length - 1 ] [ data[1] ] [ ... ]
            //                ^ pointer
            //
            // Note that this can only be done if the element to remove is the first one, which is one of the reasons
            // why Composable Pools register BPT as the first token.
            mstore(add(registeredTokens, 32), sub(mload(registeredTokens), 1))
            tokens := add(registeredTokens, 32)
        }
    }

    /**
     * @notice Returns the virtual supply, and a slice of the original balances array with the BPT balance removed.
     * @dev *This mutates the original array*, which should not be used anymore after calling this function.
     * It's recommended to call this function such that the calling function either immediately returns or overwrites
     * the original array variable so it cannot be accessed.
     */
    function dropBptFromBalances(uint256 totalSupply, uint256[] memory registeredBalances)
        internal
        pure
        returns (uint256 virtualSupply, uint256[] memory balances)
    {
        virtualSupply = totalSupply.sub(registeredBalances[0]);
        assembly {
            // See dropBptFromTokens for a detailed explanation of how this works.
            mstore(add(registeredBalances, 32), sub(mload(registeredBalances), 1))
            balances := add(registeredBalances, 32)
        }
    }

    /**
     * @notice Returns slices of the original arrays, with the BPT token address and balance removed.
     * @dev *This mutates the original arrays*, which should not be used anymore after calling this function.
     * It's recommended to call this function such that the calling function either immediately returns or overwrites
     * the original array variable so it cannot be accessed.
     */
    function dropBpt(IERC20[] memory registeredTokens, uint256[] memory registeredBalances)
        internal
        pure
        returns (IERC20[] memory tokens, uint256[] memory balances)
    {
        assembly {
            // See dropBptFromTokens for a detailed explanation of how this works
            mstore(add(registeredTokens, 32), sub(mload(registeredTokens), 1))
            tokens := add(registeredTokens, 32)

            mstore(add(registeredBalances, 32), sub(mload(registeredBalances), 1))
            balances := add(registeredBalances, 32)
        }
    }

    /**
     * @notice Returns the passed array prepended with a zero element.
     */
    function prependZeroElement(uint256[] memory array) internal pure returns (uint256[] memory prependedArray) {
        prependedArray = new uint256[](array.length + 1);
        for (uint256 i = 0; i < array.length; i++) {
            prependedArray[i + 1] = array[i];
        }
    }
}
