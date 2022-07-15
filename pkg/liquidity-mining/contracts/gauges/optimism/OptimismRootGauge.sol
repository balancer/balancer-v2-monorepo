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

import "../StakelessGauge.sol";

import "./IOptimismGasLimitProvider.sol";

interface IL1StandardBridge {
    function depositERC20To(
        address _l1Token,
        address _l2Token,
        address _to,
        uint256 _amount,
        uint32 _l2Gas,
        bytes calldata _data
    ) external;
}

contract OptimismRootGauge is ISingleRecipientGauge, StakelessGauge {
    IL1StandardBridge private immutable _optimismL1StandardBridge;
    address private immutable _optimismBal;
    IOptimismGasLimitProvider private immutable _factory;

    // This value is kept in storage and not made immutable to allow for this contract to be proxyable
    address private _recipient;

    constructor(
        IBalancerMinter minter,
        IL1StandardBridge optimismL1StandardBridge,
        address optimismBal
    ) StakelessGauge(minter) {
        _optimismL1StandardBridge = optimismL1StandardBridge;
        _optimismBal = optimismBal;
        _factory = IOptimismGasLimitProvider(msg.sender);
    }

    function initialize(address recipient) external override {
        // This will revert in all calls except the first one
        __StakelessGauge_init();

        _recipient = recipient;
    }

    function getRecipient() external view override returns (address) {
        return _recipient;
    }

    function getOptimismBridge() external view returns (IL1StandardBridge) {
        return _optimismL1StandardBridge;
    }

    function getOptimismBal() external view returns (address) {
        return _optimismBal;
    }

    function _postMintAction(uint256 mintAmount) internal override {
        _balToken.approve(address(_optimismL1StandardBridge), mintAmount);

        // This will transfer BAL to `_recipient` on the Optimism chain
        _optimismL1StandardBridge.depositERC20To(
            address(_balToken),
            _optimismBal,
            _recipient,
            mintAmount,
            _factory.getOptimismGasLimit(),
            "0x"
        );
    }
}
