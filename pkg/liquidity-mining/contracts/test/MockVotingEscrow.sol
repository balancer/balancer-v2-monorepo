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
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ISmartWalletChecker.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IVotingEscrow.sol";

// solhint-disable var-name-mixedcase
// solhint-disable func-name-mixedcase

/**
 * @dev Mock voting escrow with setters to manipulate its inner state.
 * Points are represented as mappings just for convenience, while keeping the same API for the public members
 * as the real voting escrow.
 */
contract MockVotingEscrow {
    uint256 public epoch;
    // epoch ==> Point
    mapping(uint256 => IVotingEscrow.Point) public point_history;
    // user ==> epoch ==> Point
    mapping(address => mapping(uint256 => IVotingEscrow.Point)) public user_point_history;
    // user ==> epoch
    mapping(address => uint256) public user_point_epoch;
    // user ==> lock's end
    mapping(address => uint256) public locked__end;
    // user ==> balance
    mapping(address => uint256) public balanceOf;

    ISmartWalletChecker private _smartWalletChecker;

    constructor(ISmartWalletChecker smartWalletChecker) {
        _smartWalletChecker = smartWalletChecker;
    }

    function smart_wallet_checker() external view returns (ISmartWalletChecker) {
        return _smartWalletChecker;
    }

    function setEpoch(uint256 _epoch) external {
        epoch = _epoch;
    }

    function setPointHistory(uint256 _epoch, IVotingEscrow.Point memory point) external {
        point_history[_epoch] = point;
    }

    function setUserPointEpoch(address user, uint256 _epoch) external {
        user_point_epoch[user] = _epoch;
    }

    function setUserPointHistory(
        address user,
        uint256 _epoch,
        IVotingEscrow.Point memory point
    ) external {
        user_point_history[user][_epoch] = point;
    }

    function setLockedEnd(address user, uint256 end) external {
        locked__end[user] = end;
    }

    function setBalanceOf(address user, uint256 balance) external {
        balanceOf[user] = balance;
    }
}
