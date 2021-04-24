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

import "./PoolPriceOracleMock.sol";
import "../pools/weighted/WeightedPool2Tokens.sol";

contract WeightedPool2TokensMock is WeightedPool2Tokens, PoolPriceOracleMock {
    using WordCodec for bytes32;

    struct MiscData {
        uint256 swapFeePercentage;
        bool oracleEnabled;
        uint256 oracleIndex;
        uint256 oracleSampleInitialTimestamp;
        int256 logTotalSupply;
        int256 logInvariant;
    }

    constructor(NewPoolParams memory params) WeightedPool2Tokens(params) {}

    function miscData() external view returns (MiscData memory) {
        return MiscData({
            swapFeePercentage: _miscData.decodeUint64(_MISC_SWAP_FEE_PERCENTAGE_OFFSET),
            oracleEnabled: _miscData.decodeBool(_MISC_ORACLE_ENABLED_OFFSET),
            oracleIndex: _miscData.decodeUint10(_MISC_ORACLE_INDEX_OFFSET),
            oracleSampleInitialTimestamp: _miscData.decodeUint31(_MISC_ORACLE_SAMPLE_INITIAL_TIMESTAMP_OFFSET),
            logTotalSupply: _miscData.decodeInt22(_MISC_LOG_TOTAL_SUPPLY_OFFSET),
            logInvariant: _miscData.decodeInt22(_MISC_LOG_INVARIANT_OFFSET)
        });
    }

    function mockOracleDisabled() external {
        _miscData = _miscData.storeBoolean(false, _MISC_ORACLE_ENABLED_OFFSET);
    }

    function mockMiscData(MiscData memory _data) external {
        bytes32 data = bytes32(0);
        data = data.storeUint64(_data.swapFeePercentage, _MISC_SWAP_FEE_PERCENTAGE_OFFSET);
        data = data.storeBoolean(_data.oracleEnabled, _MISC_ORACLE_ENABLED_OFFSET);
        data = data.storeUint10(_data.oracleIndex, _MISC_ORACLE_INDEX_OFFSET);
        data = data.storeUint31(_data.oracleSampleInitialTimestamp, _MISC_ORACLE_SAMPLE_INITIAL_TIMESTAMP_OFFSET);
        data = data.storeInt22(_data.logTotalSupply, _MISC_LOG_TOTAL_SUPPLY_OFFSET);
        data = data.storeInt22(_data.logInvariant, _MISC_LOG_INVARIANT_OFFSET);
        _miscData = data;
    }
}
