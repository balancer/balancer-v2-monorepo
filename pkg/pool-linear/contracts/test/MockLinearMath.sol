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

import "../LinearMath.sol";

contract MockLinearMath {
    function calcBptOutPerMainIn(
        uint256 mainIn,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 bptSupply,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);
    }

    function calcBptInPerMainOut(
        uint256 mainOut,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 bptSupply,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcBptInPerMainOut(mainOut, mainBalance, wrappedBalance, bptSupply, params);
    }

    function calcWrappedOutPerMainIn(
        uint256 mainIn,
        uint256 mainBalance,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcWrappedOutPerMainIn(mainIn, mainBalance, params);
    }

    function calcWrappedInPerMainOut(
        uint256 mainOut,
        uint256 mainBalance,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcWrappedInPerMainOut(mainOut, mainBalance, params);
    }

    function calcMainInPerBptOut(
        uint256 bptOut,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 bptSupply,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
    }

    function calcMainOutPerBptIn(
        uint256 bptIn,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 bptSupply,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcMainOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
    }

    function calcMainInPerWrappedOut(
        uint256 wrappedOut,
        uint256 mainBalance,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcMainInPerWrappedOut(wrappedOut, mainBalance, params);
    }

    function calcMainOutPerWrappedIn(
        uint256 wrappedIn,
        uint256 mainBalance,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcMainOutPerWrappedIn(wrappedIn, mainBalance, params);
    }

    function calcBptOutPerWrappedIn(
        uint256 wrappedIn,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 bptSupply,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcBptOutPerWrappedIn(wrappedIn, mainBalance, wrappedBalance, bptSupply, params);
    }

    function calcBptInPerWrappedOut(
        uint256 wrappedOut,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 bptSupply,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcBptInPerWrappedOut(wrappedOut, mainBalance, wrappedBalance, bptSupply, params);
    }

    function calcWrappedInPerBptOut(
        uint256 bptOut,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 bptSupply,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcWrappedInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
    }

    function calcWrappedOutPerBptIn(
        uint256 bptIn,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 bptSupply,
        LinearMath.Params memory params
    ) external pure returns (uint256) {
        return LinearMath._calcWrappedOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
    }
}
