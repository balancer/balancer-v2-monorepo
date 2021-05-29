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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "./IAaveIncentivesController.sol";

// solhint-disable no-unused-vars
contract MockAaveRewards is IAaveIncentivesController, ERC20("Staked Aave", "stkAAVE") {
    function handleAction(
        address, /* asset */
        uint256, /* userBalance */
        uint256 /* totalSupply */
    ) external pure override {
        revert("unused");
    }

    function getRewardsBalance(
        address[] calldata, /* assets */
        address /* user */
    ) external pure override returns (uint256) {
        revert("unused");
    }

    function claimRewards(
        address[] calldata, /* assets */
        uint256, /* amount */
        address to,
        bool /* stake */
    ) external override returns (uint256) {
        _mint(to, 1e18);
    }
}
