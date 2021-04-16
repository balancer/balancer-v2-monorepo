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

import "../vault/interfaces/IVault.sol";
import "../vault/interfaces/IBasePool.sol";

abstract contract BasePoolFactory {
    IVault private immutable _vault;
    mapping(address => bool) private _isPoolFromFactory;

    uint256 private constant _PAUSE_WINDOW_DURATION = 90 days;
    uint256 private constant _BUFFER_PERIOD_DURATION = 30 days;

    uint256 private immutable _createdPoolsPauseWindowEndTime;

    event PoolRegistered(address indexed pool);

    constructor(IVault vault) {
        _vault = vault;

        _createdPoolsPauseWindowEndTime = block.timestamp + _PAUSE_WINDOW_DURATION;
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function isPoolFromFactory(address pool) public view returns (bool) {
        return _isPoolFromFactory[pool];
    }

    /**
     * @dev Registers a new created pool. Emits a `PoolRegistered` event.
     */
    function _register(address pool) internal {
        _isPoolFromFactory[pool] = true;
        emit PoolRegistered(pool);
    }
}
