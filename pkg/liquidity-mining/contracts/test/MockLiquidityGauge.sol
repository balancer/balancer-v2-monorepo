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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

// solhint-disable func-name-mixedcase
contract MockLiquidityGauge is ILiquidityGauge {
    // solhint-disable-next-line var-name-mixedcase
    address public lp_token;
    bool private _isKilled;

    constructor() {
        // solhint-disable-previous-line no-empty-blocks
    }

    function initialize(address pool, uint256) external {
        lp_token = pool;
    }

    function is_killed() external view override returns (bool) {
        return _isKilled;
    }

    function killGauge() external override {
        _isKilled = true;
    }

    function unkillGauge() external override {
        _isKilled = false;
    }

    // Methods below are not implemented; they are present just to comply with ILiquidityGauge.
    // State mutability was set to "pure" to avoid compiler warnings.

    function integrate_fraction(address) external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function user_checkpoint(address) external pure override returns (bool) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function setRelativeWeightCap(uint256) external pure override {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getRelativeWeightCap() external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function getCappedRelativeWeight(uint256) external pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }
}
