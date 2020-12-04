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

import "../../vendor/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../FlattenedTradingStrategy.sol";

contract FlattenedFactory {
    using Address for address;
    using EnumerableSet for EnumerableSet.AddressSet;

    // TODO: Move set getters to a base factory contract
    EnumerableSet.AddressSet private _flattenedStrategies;

    function getTotalStrategies() external view returns (uint256) {
        return _flattenedStrategies.length();
    }

    function getStrategies(uint256 start, uint256 end) external view returns (address[] memory) {
        require((end >= start) && (end - start) <= _flattenedStrategies.length(), "Bad indices");

        address[] memory strategy = new address[](end - start);
        for (uint256 i = 0; i < strategy.length; ++i) {
            strategy[i] = _flattenedStrategies.at(i + start);
        }

        return strategy;
    }

    event StrategyCreated(address indexed strategy);

    // solhint-disable-next-line no-empty-blocks
    constructor() {}

    function create(bool isAmpMutable, uint128 amp, bool isSwapFeeMutable, uint256 swapFee) external returns (address) {
        bytes memory creationCode = abi.encodePacked(
            type(FlattenedTradingStrategy).creationCode,
            abi.encode(isAmpMutable, amp, isSwapFeeMutable, swapFee)
        );

        address expectedStrategy = Create2.computeAddress(0, keccak256(creationCode));

        if (expectedStrategy.isContract()) {
            return expectedStrategy;
        } else {
            address strategy = Create2.deploy(0, 0, creationCode);
            assert(strategy == expectedStrategy);

            _flattenedStrategies.add(strategy);
            emit StrategyCreated(strategy);

            return strategy;
        }
    }
}
