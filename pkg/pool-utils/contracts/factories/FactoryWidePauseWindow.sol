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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/TemporarilyPausable.sol";

/**
 * @dev Utility to create Pool factories for Pools that use the `TemporarilyPausable` contract.
 *
 * By calling `TemporarilyPausable`'s constructor with the result of `getPauseConfiguration`, all Pools created by this
 * factory will share the same Pause Window end time, after which both old and new Pools will not be pausable.
 */
contract FactoryWidePauseWindow {
    // This contract relies on timestamps in a similar way as `TemporarilyPausable` does - the same caveats apply.
    // solhint-disable not-rely-on-time

    uint256 private immutable _initialPauseWindowDuration;
    uint256 private immutable _bufferPeriodDuration;

    // Time when the pause window for all created Pools expires, and the pause window duration of new Pools becomes
    // zero.
    uint256 private immutable _poolsPauseWindowEndTime;

    constructor(uint256 initialPauseWindowDuration, uint256 bufferPeriodDuration) {
        // New pools will check on deployment that the durations given are within the bounds specified by
        // `TemporarilyPausable`. Since it is now possible for a factory to pass in arbitrary values here,
        // pre-emptively verify that these durations are valid for pool creation.
        // (Otherwise, you would be able to deploy a useless factory where `create` would always revert.)

        _require(
            initialPauseWindowDuration <= PausableConstants.MAX_PAUSE_WINDOW_DURATION,
            Errors.MAX_PAUSE_WINDOW_DURATION
        );
        _require(
            bufferPeriodDuration <= PausableConstants.MAX_BUFFER_PERIOD_DURATION,
            Errors.MAX_BUFFER_PERIOD_DURATION
        );

        _initialPauseWindowDuration = initialPauseWindowDuration;
        _bufferPeriodDuration = bufferPeriodDuration;

        _poolsPauseWindowEndTime = block.timestamp + initialPauseWindowDuration;
    }

    /**
     * @dev Returns the current `TemporarilyPausable` configuration that will be applied to Pools created by this
     * factory.
     *
     * `pauseWindowDuration` will decrease over time until it reaches zero, at which point both it and
     * `bufferPeriodDuration` will be zero forever, meaning deployed Pools will not be pausable.
     */
    function getPauseConfiguration() public view returns (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) {
        uint256 currentTime = block.timestamp;
        if (currentTime < _poolsPauseWindowEndTime) {
            // The buffer period is always the same since its duration is related to how much time is needed to respond
            // to a potential emergency. The Pause Window duration however decreases as the end time approaches.

            pauseWindowDuration = _poolsPauseWindowEndTime - currentTime; // No need for checked arithmetic.
            bufferPeriodDuration = _bufferPeriodDuration;
        } else {
            // After the end time, newly created Pools have no Pause Window, nor Buffer Period (since they are not
            // pausable in the first place).

            pauseWindowDuration = 0;
            bufferPeriodDuration = 0;
        }
    }
}
