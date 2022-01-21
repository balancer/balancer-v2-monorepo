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

import "./IControlledPool.sol";

interface IControlledManagedPool is IControlledPool {
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] calldata endWeights
    ) external;

    function setSwapEnabled(bool swapEnabled) external;

    function addAllowedAddress(address member) external;

    function removeAllowedAddress(address member) external;

    function setMustAllowlistLPs(bool mustAllowlistLPs) external;

    function withdrawCollectedManagementFees(address recipient) external;

    function setManagementSwapFeePercentage(uint256 managementSwapFeePercentage) external;
}
