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

import "../StakelessGauge.sol";

interface IGnosisBridge {
    function relayTokens(
        IERC20 token,
        address _receiver,
        uint256 _value
    ) external;
}

contract GnosisRootGauge is StakelessGauge {
    IGnosisBridge private immutable _gnosisBridge;

    // This value is kept in storage and not made immutable to allow for the recipient to be set during `initialize`
    address private _recipient;

    constructor(IMainnetBalancerMinter minter, IGnosisBridge gnosisBridge) StakelessGauge(minter) {
        _gnosisBridge = gnosisBridge;
    }

    function initialize(address recipient, uint256 relativeWeightCap) external {
        // This will revert in all calls except the first one
        __StakelessGauge_init(relativeWeightCap);

        _recipient = recipient;
    }

    function getRecipient() external view override returns (address) {
        return _recipient;
    }

    function getGnosisBridge() external view returns (IGnosisBridge) {
        return _gnosisBridge;
    }

    function _postMintAction(uint256 mintAmount) internal override {
        _balToken.approve(address(_gnosisBridge), mintAmount);

        // This will transfer BAL to `_recipient` on Gnosis Chain
        _gnosisBridge.relayTokens(_balToken, _recipient, mintAmount);
    }
}
