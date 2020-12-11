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

import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../../math/FixedPoint.sol";

contract AmpStrategySetting {
    using SafeCast for uint256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    uint128 private _mutableAmp;
    uint128 private immutable _immutableAmp;
    bool private immutable _isMutable;

    struct Amp {
        bool isMutable;
        uint128 value;
    }

    event AmpSet(uint256 amp);

    constructor(Amp memory amp) {
        _isMutable = amp.isMutable;
        _immutableAmp = amp.isMutable ? 0 : amp.value;
        if (amp.isMutable) {
            _mutableAmp = amp.value;
        }
        emit AmpSet(amp.value);
    }

    /**
     * @dev Returns the amp for the trading strategy
     */
    function getAmp() external view returns (uint128) {
        return _amp();
    }

    /**
     * @dev Internal function to set a new amp
     * @param amp New amp to be set
     */
    function _setAmp(uint128 amp) internal {
        require(_isMutable, "AMP_NOT_MUTABLE");
        _mutableAmp = amp;
        emit AmpSet(amp);
    }

    /**
     * @dev Internal function to tell the amp for the trading strategy
     */
    function _amp() internal view returns (uint128) {
        return _isMutable ? _mutableAmp : _immutableAmp;
    }
}
