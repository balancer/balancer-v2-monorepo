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
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-core/contracts/lib/openzeppelin/Address.sol";
import "@balancer-labs/v2-core/contracts/lib/openzeppelin/Create2.sol";

import "@balancer-labs/v2-core/contracts/test/TestToken.sol";

contract TokenFactory {
    using Address for address;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _tokens;

    event TokenCreated(address indexed token);

    constructor() {
        // solhint-disable-previous-line no-empty-blocks
    }

    function getTotalTokens() external view returns (uint256) {
        return _tokens.length();
    }

    function getTokens(uint256 start, uint256 end) external view returns (address[] memory) {
        require((end >= start) && (end - start) <= _tokens.length(), "OUT_OF_BOUNDS");

        address[] memory token = new address[](end - start);
        for (uint256 i = 0; i < token.length; ++i) {
            token[i] = _tokens.at(i + start);
        }

        return token;
    }

    function create(
        address admin,
        string memory name,
        string memory symbol,
        uint8 decimals
    ) external returns (address) {
        bytes memory creationCode = abi.encodePacked(
            type(TestToken).creationCode,
            abi.encode(admin, name, symbol, decimals)
        );

        address expectedToken = Create2.computeAddress(0, keccak256(creationCode));

        if (expectedToken.isContract()) {
            return expectedToken;
        } else {
            address token = Create2.deploy(0, 0, creationCode);
            assert(token == expectedToken);

            _tokens.add(token);
            emit TokenCreated(token);

            return token;
        }
    }
}
