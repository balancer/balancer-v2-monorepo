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

import "../CWPTradingStrategy.sol";

contract CWPFactory {
    using Address for address;
    using EnumerableSet for EnumerableSet.AddressSet;

    // TODO: Move set getters to a base factory contract
    EnumerableSet.AddressSet private _weightedProdStrategies;

    event StrategyCreated(address indexed strategy);

    // solhint-disable-next-line no-empty-blocks
    constructor() {}

    function getTotalStrategies() external view returns (uint256) {
        return _weightedProdStrategies.length();
    }

    function getStrategies(uint256 start, uint256 end) external view returns (address[] memory) {
        require((end >= start) && (end - start) <= _weightedProdStrategies.length(), "Bad indices");

        address[] memory strategy = new address[](end - start);
        for (uint256 i = 0; i < strategy.length; ++i) {
            strategy[i] = _weightedProdStrategies.at(i + start);
        }

        return strategy;
    }

    function create(
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFee
    ) external returns (address) {
        bytes memory creationCode = abi.encodePacked(
            type(CWPTradingStrategy).creationCode,
            abi.encode(tokens, weights, swapFee)
        );

        address expectedStrategy = Create2.computeAddress(0, keccak256(creationCode));

        if (expectedStrategy.isContract()) {
            return expectedStrategy;
        } else {
            address strategy = Create2.deploy(0, 0, creationCode);
            assert(strategy == expectedStrategy);

            _weightedProdStrategies.add(strategy);
            emit StrategyCreated(strategy);

            return strategy;
        }
    }
}
