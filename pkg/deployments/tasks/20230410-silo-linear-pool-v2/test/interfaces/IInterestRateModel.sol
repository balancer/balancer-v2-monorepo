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

interface IInterestRateModel {
    /**
     * @dev get compound interest rate
     * @param silo address of Silo
     * @param asset address of an asset in Silo for which interest rate should be calculated
     * @param blockTimestamp current block timestamp
     * @return rcomp compounded interest rate from last update until now (1e18 == 100%)
     */
    function getCompoundInterestRate(
        address silo,
        address asset,
        uint256 blockTimestamp
    ) external view returns (uint256 rcomp);

    /**
     * @dev get current annual interest rate
     * @param silo address of Silo
     * @param asset address of an asset in Silo for which interest rate should be calculated
     * @param blockTimestamp current block timestamp
     * @return rcur current annual interest rate (1e18 == 100%)
     */
    function getCurrentInterestRate(
        address silo,
        address asset,
        uint256 blockTimestamp
    ) external view returns (uint256 rcur);
}
