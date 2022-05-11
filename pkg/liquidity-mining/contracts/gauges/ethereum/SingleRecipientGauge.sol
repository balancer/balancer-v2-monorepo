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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ISingleRecipientGauge.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "../StakelessGauge.sol";

contract SingleRecipientGauge is ISingleRecipientGauge, StakelessGauge {
    using SafeERC20 for IERC20;

    address private _recipient;

    constructor(IBalancerMinter minter) StakelessGauge(minter) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function initialize(address recipient) external override {
        // This will revert in all calls except the first one
        __StakelessGauge_init();

        _recipient = recipient;
    }

    function getRecipient() external view override returns (address) {
        return _recipient;
    }

    function _postMintAction(uint256 mintAmount) internal override {
        _balToken.safeTransfer(_recipient, mintAmount);
    }
}
