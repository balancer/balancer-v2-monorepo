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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IFeeDistributor.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/Version.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "../StakelessGauge.sol";

contract SingleRecipientGauge is Version, StakelessGauge {
    using SafeERC20 for IERC20;

    address private _recipient;
    bool private _feeDistributorRecipient;

    // The version of the implementation is irrelevant, so we use an empty string.
    // The actual gauge version will be set during initialization.
    constructor(IMainnetBalancerMinter minter) Version("") StakelessGauge(minter) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function initialize(
        address recipient,
        uint256 relativeWeightCap,
        bool feeDistributorRecipient,
        string memory version
    ) external {
        // This will revert in all calls except the first one
        __StakelessGauge_init(relativeWeightCap);

        _recipient = recipient;
        _feeDistributorRecipient = feeDistributorRecipient;
        _setVersion(version);
    }

    function getRecipient() public view override returns (address) {
        return _recipient;
    }

    function isRecipientFeeDistributor() public view returns (bool) {
        return _feeDistributorRecipient;
    }

    function _postMintAction(uint256 mintAmount) internal override {
        address recipient = getRecipient();

        if (isRecipientFeeDistributor()) {
            _balToken.safeApprove(recipient, mintAmount);
            IFeeDistributor(recipient).depositToken(_balToken, mintAmount);
        } else {
            _balToken.safeTransfer(recipient, mintAmount);
        }
    }
}
