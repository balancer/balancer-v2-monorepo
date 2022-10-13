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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGauge.sol";

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

contract MockLiquidityGauge is ILiquidityGauge {
    // solhint-disable-next-line var-name-mixedcase
    address public lp_token;

    constructor() {
        // solhint-disable-previous-line no-empty-blocks
    }

    function initialize(address pool, uint256) external {
        lp_token = pool;
    }

    // Methods below are not implemented; they are present just to comply with ILiquidityGauge.
    // State mutability was set to "pure" to avoid compiler warnings.
    // solhint-disable func-name-mixedcase

    function integrate_fraction(address) external pure override returns (uint256) {
        revert("Mock method; not implemented");
    }

    function user_checkpoint(address) external pure override returns (bool) {
        revert("Mock method; not implemented");
    }

    function is_killed() external pure override returns (bool) {
        revert("Mock method; not implemented");
    }

    function killGauge() external pure override {
        revert("Mock method; not implemented");
    }

    function unkillGauge() external pure override {
        revert("Mock method; not implemented");
    }

    function setRelativeWeightCap(uint256) external pure override {
        revert("Mock method; not implemented");
    }

    function getRelativeWeightCap() external pure override returns (uint256) {
        revert("Mock method; not implemented");
    }

    function getCappedRelativeWeight(uint256) external pure override returns (uint256) {
        revert("Mock method; not implemented");
    }
}
