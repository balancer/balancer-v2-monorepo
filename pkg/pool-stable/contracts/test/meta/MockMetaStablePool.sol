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

import "@balancer-labs/v2-pool-utils/contracts/test/oracle/MockPoolPriceOracle.sol";

import "./MockStableOracleMath.sol";
import "../../meta/MetaStablePool.sol";
import "../../meta/OracleMiscData.sol";

contract MockMetaStablePool is MetaStablePool, MockPoolPriceOracle, MockStableOracleMath {
    using OracleMiscData for bytes32;

    struct MiscData {
        int256 logInvariant;
        int256 logTotalSupply;
        uint256 oracleSampleCreationTimestamp;
        uint256 oracleIndex;
        bool oracleEnabled;
    }

    constructor(NewPoolParams memory params) MetaStablePool(params) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function getScalingFactor(IERC20 token) external view returns (uint256) {
        return _scalingFactor(token);
    }

    function mockCachePriceRatesIfNecessary() external {
        _cachePriceRatesIfNecessary();
    }

    function mockOracleDisabled() external {
        _setOracleEnabled(false);
    }

    function mockOracleIndex(uint256 index) external {
        _setMiscData(_getMiscData().setOracleIndex(index));
    }

    function mockMiscData(MiscData memory miscData) external {
        _setMiscData(encode(miscData));
    }

    function encode(MiscData memory _data) private pure returns (bytes32 data) {
        data = data.setOracleEnabled(_data.oracleEnabled);
        data = data.setOracleIndex(_data.oracleIndex);
        data = data.setOracleSampleCreationTimestamp(_data.oracleSampleCreationTimestamp);
        data = data.setLogTotalSupply(_data.logTotalSupply);
        data = data.setLogInvariant(_data.logInvariant);
    }
}
