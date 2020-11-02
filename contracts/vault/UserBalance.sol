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

import "hardhat/console.sol";

import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "./IVault.sol";
import "./VaultAccounting.sol";
import "./PoolRegistry.sol";

import "../math/FixedPoint.sol";

abstract contract UserBalance is IVault, VaultAccounting {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixedPoint for uint128;

    mapping(address => mapping(address => uint128)) internal _userTokenBalance; // user -> token -> user balance
    // operators are allowed to use a user's tokens in a swap
    mapping(address => EnumerableSet.AddressSet) private _userOperators;

    event Deposited(
        address indexed depositor,
        address indexed user,
        address indexed token,
        uint128 amount
    );

    event Withdrawn(
        address indexed user,
        address indexed recipient,
        address indexed token,
        uint128 amount
    );

    event AuthorizedOperator(address indexed user, address indexed operator);
    event RevokedOperator(address indexed user, address indexed operator);

    function getUserTokenBalance(address user, address token)
        public
        view
        returns (uint128)
    {
        return _userTokenBalance[user][token];
    }

    function deposit(
        address token,
        uint128 amount,
        address user
    ) external {
        // Pulling from the sender - no need to check for operators
        uint128 received = _pullTokens(token, msg.sender, amount);

        // TODO: check overflow
        _userTokenBalance[user][token] = _userTokenBalance[user][token].add128(
            received
        );
        emit Deposited(msg.sender, user, token, received);
    }

    function withdraw(
        address token,
        uint128 amount,
        address recipient
    ) external {
        require(
            _userTokenBalance[msg.sender][token] >= amount,
            "Vault: withdraw amount exceeds balance"
        );

        _userTokenBalance[msg.sender][token] -= amount;
        _pushTokens(token, recipient, amount);

        emit Withdrawn(msg.sender, recipient, token, amount);
    }

    function authorizeOperator(address operator) external {
        if (_userOperators[msg.sender].add(operator)) {
            emit AuthorizedOperator(msg.sender, operator);
        }
    }

    function revokeOperator(address operator) external {
        if (_userOperators[msg.sender].remove(operator)) {
            emit RevokedOperator(msg.sender, operator);
        }
    }

    function isOperatorFor(address user, address operator)
        public
        view
        returns (bool)
    {
        return (user == operator) || _userOperators[user].contains(operator);
    }

    function getUserTotalOperators(address user)
        external
        view
        returns (uint256)
    {
        return _userOperators[user].length();
    }

    function getUserOperators(
        address user,
        uint256 start,
        uint256 end
    ) external view returns (address[] memory) {
        // Ideally we'd use a native implemenation: see
        // https://github.com/OpenZeppelin/openzeppelin-contracts/issues/2390
        address[] memory operators = new address[](
            _userOperators[user].length()
        );

        for (uint256 i = start; i < end; ++i) {
            operators[i] = _userOperators[user].at(i);
        }

        return operators;
    }
}
