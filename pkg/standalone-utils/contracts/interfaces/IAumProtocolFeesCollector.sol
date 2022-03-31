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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAuthorizer.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

interface IAumProtocolFeesCollector {
    event AumFeePercentageChanged(uint256 newAumFeePercentage);

    function withdrawCollectedFees(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external;

    function setAumFeePercentage(uint256 newSwapFeePercentage) external;

    function getAumFeePercentage() external view returns (uint256);

    function getCollectedFeeAmounts(IERC20[] memory tokens) external view returns (uint256[] memory feeAmounts);

    function getAuthorizer() external view returns (IAuthorizer);

    function vault() external view returns (IVault);
}
