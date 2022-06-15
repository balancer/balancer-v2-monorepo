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

abstract contract MockFailureModes {
    enum FailureMode { INVARIANT, PRICE_RATE }

    // Set to true to simulate a given failure mode
    mapping(FailureMode => bool) private _failureState;

    // Error message to return in simulated failure mode
    mapping(FailureMode => uint256) private _failureCode;

    modifier whenNotInFailureMode(FailureMode mode) {
        _ensureNotFailed(mode);
        _;
    }

    // Simulate a failure by turning on the associated failure mode flag
    function setFailureMode(FailureMode mode, bool failed) external {
        _failureState[mode] = failed;
    }

    // It is *possible* for the same failure state to generate different error messages in different situations
    // (though ideally this would not be the case). Allow for updating the associated code here.
    function setFailureCode(FailureMode mode, uint256 errorCode) external {
        _failureCode[mode] = errorCode;
    }

    // Revert with the associated message if this failure mode is activated
    function _ensureNotFailed(FailureMode mode) private view {
        if (_failureState[mode]) {
            _revert(_failureCode[mode] == 0 ? Errors.INDUCED_FAILURE : _failureCode[mode]);
        }
    }
}
