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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

abstract contract MockInvariantDependency {
    bool private _simulateInvariantFailure;

    modifier whenInvariantConverges {
        _ensureInvariantConverges();
        _;
    }

    // Simulate failure of the invariant to converge
    function setInvariantFailure(bool invariantFailsToConverge) external {
        _simulateInvariantFailure = invariantFailsToConverge;
    }

    function invariantConverges() external view returns (bool) {
        return !_simulateInvariantFailure;
    }

    function _ensureInvariantConverges() internal view {
        if (_simulateInvariantFailure) {
            _revert(Errors.STABLE_INVARIANT_DIDNT_CONVERGE);
        }
    }
}