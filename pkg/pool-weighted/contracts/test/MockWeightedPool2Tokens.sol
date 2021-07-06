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

import "./MockWeightedOracleMath.sol";
import "../WeightedPool2Tokens.sol";

contract MockWeightedPool2Tokens is WeightedPool2Tokens, MockPoolPriceOracle, MockWeightedOracleMath {
    using WeightedPool2TokensMiscData for bytes32;

    struct MiscData {
        int256 logInvariant;
        int256 logTotalSupply;
        uint256 oracleSampleCreationTimestamp;
        uint256 oracleIndex;
        bool oracleEnabled;
        uint256 swapFeePercentage;
    }

    constructor(NewPoolParams memory params) WeightedPool2Tokens(params) {}

    function mockOracleDisabled() external {
        _setOracleEnabled(false);
    }

    function mockOracleIndex(uint256 index) external {
        _miscData = _miscData.setOracleIndex(index);
    }

    function mockMiscData(MiscData memory miscData) external {
        _miscData = encode(miscData);
    }

    /**
     * @dev Encodes a misc data object into a bytes32
     */
    function encode(MiscData memory _data) private pure returns (bytes32 data) {
        data = data.setSwapFeePercentage(_data.swapFeePercentage);
        data = data.setOracleEnabled(_data.oracleEnabled);
        data = data.setOracleIndex(_data.oracleIndex);
        data = data.setOracleSampleCreationTimestamp(_data.oracleSampleCreationTimestamp);
        data = data.setLogTotalSupply(_data.logTotalSupply);
        data = data.setLogInvariant(_data.logInvariant);
    }
}
