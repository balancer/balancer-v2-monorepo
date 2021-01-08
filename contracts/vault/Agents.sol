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

import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "./Authorization.sol";

abstract contract Agents is Authorization {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Agents are allowed to use a user's tokens in a swap
    mapping(address => EnumerableSet.AddressSet) private _userAgents;

    // Universal agents are agents for all users, without needing to be authorized. They cannot be revoked by individual
    // users, only by an Universal Agent Manager.
    EnumerableSet.AddressSet private _universalAgents;

    // Universal Agent managers can report new Universal Agents
    EnumerableSet.AddressSet internal _universalAgentManagers;

    event UserAgentAdded(address indexed user, address indexed agent);
    event UserAgentRemoved(address indexed user, address indexed agent);

    event UniversalAgentAdded(address indexed agent);
    event UniversalAgentRemoved(address indexed agent);

    function addUserAgent(address agent) external override {
        if (_userAgents[msg.sender].add(agent)) {
            emit UserAgentAdded(msg.sender, agent);
        }
    }

    function removeUserAgent(address agent) external override {
        if (_userAgents[msg.sender].remove(agent)) {
            emit UserAgentRemoved(msg.sender, agent);
        }
    }

    function isAgentFor(address user, address agent) public view override returns (bool) {
        return (user == agent) || _universalAgents.contains(agent) || _userAgents[user].contains(agent);
    }

    function getNumberOfUserAgents(address user) external view override returns (uint256) {
        return _userAgents[user].length();
    }

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

    function getNumberOfUniversalAgents() external view override returns (uint256) {
        return _universalAgents.length();
    }

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

    function addUniversalAgent(address agent) external override {
        require(getAuthorizer().canAddUniversalAgent(msg.sender), "Caller cannot add Universal Agents");

        if (_universalAgents.add(agent)) {
            emit UniversalAgentAdded(agent);
        }
    }

    function removeUniversalAgent(address agent) external override {
        require(getAuthorizer().canRemoveUniversalAgent(msg.sender), "Caller cannot remove Universal Agents");

        if (_universalAgents.remove(agent)) {
            emit UniversalAgentRemoved(agent);
        }
    }
}
