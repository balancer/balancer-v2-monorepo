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

import "../../lib/helpers/WordCodec.sol";

contract WeightedPool2TokensMiscData {
    using WordCodec for bytes32;
    using WordCodec for uint256;

    uint256 internal constant _MISC_LOG_INVARIANT_OFFSET = 0;
    uint256 internal constant _MISC_LOG_TOTAL_SUPPLY_OFFSET = 22;
    uint256 internal constant _MISC_ORACLE_SAMPLE_INITIAL_TIMESTAMP_OFFSET = 44;
    uint256 internal constant _MISC_ORACLE_INDEX_OFFSET = 75;
    uint256 internal constant _MISC_ORACLE_ENABLED_OFFSET = 85;
    uint256 internal constant _MISC_SWAP_FEE_PERCENTAGE_OFFSET = 86;

    struct MiscData {
        uint256 swapFeePercentage;
        bool oracleEnabled;
        uint256 oracleIndex;
        uint256 oracleSampleInitialTimestamp;
        int256 logTotalSupply;
        int256 logInvariant;
    }

    // This storage slot holds seemingly unrelated pieces of information: they are all kept together to reduce the
    // number of storage reads. In particular, we not only store configuration values (such as the swap fee percentage),
    // but also cache reduced-precision versions of the total BPT supply and invariant, which lets us not access nor
    // compute this values when producing oracle updates during a swap.
    // Data is packed according to the following format:
    //
    // [ swap fee pct | oracle enabled | oracle index | oracle sample initial timestamp | log supply | log invariant ]
    // [    uint64    |      bool      |    uint10    |              uint31             |    int22   |     int22     ]
    //
    // Note that are not using the most-significant 106 bits.
    bytes32 private _miscData;

    function _getMiscData() internal view returns (MiscData memory) {
        return
            MiscData({
                swapFeePercentage: _miscData.decodeUint64(_MISC_SWAP_FEE_PERCENTAGE_OFFSET),
                oracleEnabled: _miscData.decodeBool(_MISC_ORACLE_ENABLED_OFFSET),
                oracleIndex: _miscData.decodeUint10(_MISC_ORACLE_INDEX_OFFSET),
                oracleSampleInitialTimestamp: _miscData.decodeUint31(_MISC_ORACLE_SAMPLE_INITIAL_TIMESTAMP_OFFSET),
                logTotalSupply: _miscData.decodeInt22(_MISC_LOG_TOTAL_SUPPLY_OFFSET),
                logInvariant: _miscData.decodeInt22(_MISC_LOG_INVARIANT_OFFSET)
            });
    }

    function _setMiscData(MiscData memory _data) internal {
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
