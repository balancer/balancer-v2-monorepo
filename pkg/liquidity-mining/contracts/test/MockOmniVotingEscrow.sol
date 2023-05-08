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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IOmniVotingEscrow.sol";

contract MockOmniVotingEscrow is IOmniVotingEscrow {
    event SendUserBalance(
        address user,
        uint16 chainId,
        address refundAddress,
        address zroPaymentAddress,
        bytes adapterParams,
        uint256 value
    );

    // chain ID --> native fee
    mapping(uint16 => uint256) private _nativeFee;
    uint256 private _zroFee;

    function estimateSendUserBalance(
        uint16 chainId,
        bool,
        bytes calldata
    ) external view override returns (uint256 nativeFee, uint256 zroFee) {
        return (_nativeFee[chainId], _zroFee);
    }

    function sendUserBalance(
        address _user,
        uint16 _dstChainId,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) external payable override {
        emit SendUserBalance(_user, _dstChainId, _refundAddress, _zroPaymentAddress, _adapterParams, msg.value);
    }

    function setNativeFee(uint256 nativeFee, uint16 chainId) external {
        _nativeFee[chainId] = nativeFee;
    }
}
