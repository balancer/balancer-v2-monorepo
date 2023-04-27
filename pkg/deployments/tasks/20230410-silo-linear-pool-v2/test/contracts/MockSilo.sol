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

import "../interfaces/ISilo.sol";
import "../interfaces/ISiloRepository.sol";
import "./MockBaseSilo.sol";

contract MockSilo is ISilo, MockBaseSilo {
    constructor(ISiloRepository _siloRepository, address _siloAsset) MockBaseSilo(_siloRepository, _siloAsset) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function deposit(
        address, /* _asset */
        uint256, /* _amount */
        bool /* _collateralOnly */
    ) external pure override returns (uint256 collateralAmount, uint256 collateralShare) {
        return (0, 0);
    }

    function withdraw(
        address, /* _asset */
        uint256, /* _amount */
        bool /* _collateralOnly */
    ) external pure override returns (uint256 withdrawnAmount, uint256 withdrawnShare) {
        return (0, 0);
    }
}
