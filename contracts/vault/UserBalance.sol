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

// Imports

import "hardhat/console.sol";

import "../vendor/EnumerableSet.sol";
import "./VaultAccounting.sol";
import "../math/FixedPoint.sol";

// Contracts

/**
 * @title Manage user balances (i.e., user "wallets" in the vault). Store and balance agents (user and universal)
 * @author Balancer Labs
 */
abstract contract UserBalance is VaultAccounting {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixedPoint for uint128;

    // State variables

    // user -> token -> user balance
    mapping(address => mapping(IERC20 => uint128)) internal _userTokenBalance;

    // Agents are allowed to use a user's tokens in a swap
    mapping(address => EnumerableSet.AddressSet) private _userAgents;

    // Universal agents are agents for all users, without needing to be authorized
    EnumerableSet.AddressSet private _universalAgents;

    // Universal agent managers can add/remove universal agents
    EnumerableSet.AddressSet internal _universalAgentManagers;

    // Event declarations

    event Deposited(address indexed depositor, address indexed user, IERC20 indexed token, uint128 amount);

    event Withdrawn(address indexed user, address indexed recipient, IERC20 indexed token, uint128 amount);

    event AddedUserAgent(address indexed user, address indexed agent);
    event RemovedUserAgent(address indexed user, address indexed agent);

    event AddedUniversalAgent(address indexed agent);
    event RemovedUniversalAgent(address indexed agent);

    // Modifiers

    modifier onlyUniversalAgentManagers() {
        require(_universalAgentManagers.contains(msg.sender), "Caller is not a universal agent manager");
        _;
    }

    // Function declarations

    // External functions

    /**
     * @notice Deposit funds to a user's balance
     * @param token - the token to deposit
     * @param amount - the amount of the deposit
     * @param user - the account we're depositing to (need not be the caller - anyone can deposit)
     */
    function deposit(
        IERC20 token,
        uint128 amount,
        address user
    ) external override {
        // Pulling from the sender - no need to check for agents
        uint128 received = _pullTokens(token, msg.sender, amount);

        _userTokenBalance[user][token] = _userTokenBalance[user][token].add128(received);
        emit Deposited(msg.sender, user, token, received);
    }

    /**
     * @notice Withdraw funds from a user's balance
     * @param token - the token to withdraw
     * @param amount - the amount of the withdrawal
     * @param recipient - the beneficiary (we are withdrawing from the caller's account)
     */
    function withdraw(
        IERC20 token,
        uint128 amount,
        address recipient
    ) external override {
        require(_userTokenBalance[msg.sender][token] >= amount, "Vault: withdraw amount exceeds balance");

        _userTokenBalance[msg.sender][token] -= amount;
        _pushTokens(token, recipient, amount, true);

        emit Withdrawn(msg.sender, recipient, token, amount);
    }

    /**
     * @notice Register the given address as an agent for the caller
     * @param agent - the address of the agent being added
     */
    function addUserAgent(address agent) external override {
        if (_userAgents[msg.sender].add(agent)) {
            emit AddedUserAgent(msg.sender, agent);
        }
    }

    /**
     * @notice Revoke the given account's permission to act as an agent for the caller
     * @param agent - the address of the agent being removed
     */
    function removeUserAgent(address agent) external override {
        if (_userAgents[msg.sender].remove(agent)) {
            emit RemovedUserAgent(msg.sender, agent);
        }
    }

    /**
     * @notice Retrieve the total number of user agents for a given user
     * @param user - the subject of the query
     * @return - count of user agents (not including universal agents)
     */
    function getNumberOfUserAgents(address user) external view override returns (uint256) {
        return _userAgents[user].length();
    }

    /**
     * @notice Returns a partial list of user's agents as a 0-based, exclusive range [start, end)
     * @param user - subject of the query
     * @param start - 0-based index into the list
     * @param end - ending index (exclusive)
     * @return list of addresses representing a "page" of user agents
     */
    function getUserAgents(
        address user,
        uint256 start,
        uint256 end
    ) external view override returns (address[] memory) {
        require((end >= start) && (end - start) <= _userAgents[user].length(), "Bad indices");

        // Ideally we'd use a native implemenation: see
        // https://github.com/OpenZeppelin/openzeppelin-contracts/issues/2390
        address[] memory agents = new address[](end - start);

        for (uint256 i = 0; i < agents.length; ++i) {
            agents[i] = _userAgents[user].at(i + start);
        }

        return agents;
    }

    /**
     * @notice Retrieve the total number of universal agents (same for all users)
     * @return Count of all registered universal agents
     */
    function getNumberOfUniversalAgents() external view override returns (uint256) {
        return _universalAgents.length();
    }

    /**
     * @notice Returns a partial list of universal agents as a 0-based, exclusive range [start, end)
     * @param start - 0-based index into the list
     * @param end - ending index (exclusive)
     * @return list of addresses representing a "page" of universal agents
     */
    function getUniversalAgents(uint256 start, uint256 end) external view override returns (address[] memory) {
        require((end >= start) && (end - start) <= _universalAgents.length(), "Bad indices");

        // Ideally we'd use a native implemenation: see
        // https://github.com/OpenZeppelin/openzeppelin-contracts/issues/2390
        address[] memory agents = new address[](end - start);

        for (uint256 i = 0; i < agents.length; ++i) {
            agents[i] = _universalAgents.at(i + start);
        }

        return agents;
    }

    /**
     * @notice Retrieve the total number of universal agent managers (same for all users)
     * @return Count of all registered universal agent managers
     */
    function getNumberOfUniversalAgentManagers() external view override returns (uint256) {
        return _universalAgentManagers.length();
    }

    /**
     * @notice Returns a partial list of universal agent managers as a 0-based, exclusive range [start, end)
     * @param start - 0-based index into the list
     * @param end - ending index (exclusive)
     * @return list of addresses representing a "page" of uiniversal agent managers
     */
    function getUniversalAgentManagers(uint256 start, uint256 end) external view override returns (address[] memory) {
        require((end >= start) && (end - start) <= _universalAgentManagers.length(), "Bad indices");

        // Ideally we'd use a native implemenation: see
        // https://github.com/OpenZeppelin/openzeppelin-contracts/issues/2390
        address[] memory universalAgentManagers = new address[](end - start);

        for (uint256 i = 0; i < universalAgentManagers.length; ++i) {
            universalAgentManagers[i] = _universalAgentManagers.at(i + start);
        }

        return universalAgentManagers;
    }

    /**
     * @notice Register a new universal agent for all users
     * @param universalAgent - the new agent
     */
    function addUniversalAgent(address universalAgent) external override onlyUniversalAgentManagers {
        if (_universalAgents.add(universalAgent)) {
            emit AddedUniversalAgent(universalAgent);
        }
    }

    /**
     * @notice Remove a given universal agent for all users
     * @dev This might be done in response to a security incident (e.g., with a factory)
     * @param universalAgent - the universal agent to remove
     */
    function removeUniversalAgent(address universalAgent) external override onlyUniversalAgentManagers {
        if (_universalAgents.remove(universalAgent)) {
            emit RemovedUniversalAgent(universalAgent);
        }
    }

    // Public functions

    /**
     * @notice Get the total User Balance of a given token
     * @param user - the account we are querying
     * @param token - the token whose balance we want
     * @return the token balance for the given user
     */
    function getUserTokenBalance(address user, IERC20 token) public view override returns (uint128) {
        return _userTokenBalance[user][token];
    }

    /**
     * @notice Check whether the agent account is a registered agent for user
     * @param user - the account that owns the funds
     * @param agent - the account acting on behalf of the user (e.g., adding liquidity or performing swaps)
     * @return flag; true if the agent is allowed to act as an agent for the user
     */
    function isAgentFor(address user, address agent) public view override returns (bool) {
        return (user == agent) || _universalAgents.contains(agent) || _userAgents[user].contains(agent);
    }
}
