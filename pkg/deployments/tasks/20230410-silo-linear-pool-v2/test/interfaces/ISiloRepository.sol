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

pragma solidity >=0.7.0 <0.9.0;

import "./IInterestRateModel.sol";

interface ISiloRepository {
    /**
     * @notice Get Interest Rate Model address for asset in given Silo
     * @dev If dedicated config is not set, method returns default config
     * @param silo address of Silo
     * @param asset address of an asset
     * @return address of interest rate model
     */
    function getInterestRateModel(address silo, address asset) external view returns (IInterestRateModel);

    /**
     * @dev Get protocol share fee
     * @return protocol share fee in precision points (Solvency._PRECISION_DECIMALS == 100%)
     */
    function protocolShareFee() external view returns (uint256);
}
