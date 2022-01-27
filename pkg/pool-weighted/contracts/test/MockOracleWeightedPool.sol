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

import "./MockOracleWeightedMath.sol";
import "../oracle/OracleWeightedPool.sol";

contract MockOracleWeightedPool is OracleWeightedPool, MockOracleWeightedMath {
    using OracleWeightedPoolMiscData for bytes32;

    // MiscData is now just the least significant 192 bits, and no longer contains the swapFeePercentage
    struct MiscData {
        int256 logInvariant;
        int256 logTotalSupply;
        uint256 oracleSampleCreationTimestamp;
        uint256 oracleIndex;
        bool oracleEnabled;
    }

    constructor(NewPoolParams memory params) OracleWeightedPool(params) {}

    function mockOracleDisabled() external {
        _setOracleEnabled(false);
    }

    function mockOracleIndex(uint256 index) external {
        _setMiscData(_getMiscData().setOracleIndex(index));
    }

    function mockMiscData(MiscData memory miscData) external {
        _setMiscData(_encode(miscData));
    }

    /**
     * @dev Encodes a misc data object into a bytes32
     */
    function _encode(MiscData memory _data) private pure returns (bytes32 data) {
        return
            data
                .setOracleEnabled(_data.oracleEnabled)
                .setOracleIndex(_data.oracleIndex)
                .setOracleSampleCreationTimestamp(_data.oracleSampleCreationTimestamp)
                .setLogTotalSupply(_data.logTotalSupply)
                .setLogInvariant(_data.logInvariant);
    }
}
