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

import "@balancer-labs/v2-pool-utils/contracts/test/MaliciousQueryReverter.sol";

import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/ISilo.sol";
import "./MockBaseSilo.sol";

contract MockSilo is ISilo, MockBaseSilo {
    constructor(address _siloAsset) MockBaseSilo(_siloAsset) {
        // initial setup is done in BaseSilo, nothing to do here
    }

    function deposit(
        address /*_asset*/,
        uint256 /*_amount*/,
        bool /*_collateralOnly*/
    ) external override pure returns (uint256 collateralAmount, uint256 collateralShare) {
        return (0,0);
    }

    function withdraw(
        address /*_asset*/,
        uint256 /*_amount*/,
        bool /*_collateralOnly*/
    ) external override pure returns (uint256 withdrawnAmount, uint256 withdrawnShare) {
        return (0,0);
    }
}
