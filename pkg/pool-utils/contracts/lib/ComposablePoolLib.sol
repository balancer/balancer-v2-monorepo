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

library ComposablePoolLib {
    using FixedPoint for uint256;

    function dropBptFromTokens(IERC20[] memory registeredTokens) internal pure returns (IERC20[] memory tokens) {
        assembly {
            mstore(add(registeredTokens, 32), sub(mload(registeredTokens), 1))
            tokens := add(registeredTokens, 32)
        }
    }

    function dropBptFromBalances(uint256 totalSupply, uint256[] memory registeredBalances)
        internal
        pure
        returns (uint256 virtualSupply, uint256[] memory balances)
    {
        virtualSupply = totalSupply.sub(registeredBalances[0]);
        assembly {
            mstore(add(registeredBalances, 32), sub(mload(registeredBalances), 1))
            balances := add(registeredBalances, 32)
        }
    }

    function dropBpt(IERC20[] memory registeredTokens, uint256[] memory registeredBalances)
        internal
        pure
        returns (IERC20[] memory tokens, uint256[] memory balances)
    {
        assembly {
            mstore(add(registeredTokens, 32), sub(mload(registeredTokens), 1))
            tokens := add(registeredTokens, 32)

            mstore(add(registeredBalances, 32), sub(mload(registeredBalances), 1))
            balances := add(registeredBalances, 32)
        }
    }

    function prependZeroElement(uint256[] memory array) internal pure returns (uint256[] memory prependedArray) {
        prependedArray = new uint256[](array.length + 1);
        for (uint256 i = 0; i < array.length; i++) {
            prependedArray[i + 1] = array[i];
        }
    }
}
