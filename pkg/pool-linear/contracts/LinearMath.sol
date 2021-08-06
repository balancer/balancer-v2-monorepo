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

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

contract LinearMath {
    using FixedPoint for uint256;

    // solhint-disable private-vars-leading-underscore
    uint256 private constant FEE = 0.01e18;
    uint256 private constant TARGET_1 = 1000e18;
    uint256 private constant TARGET_2 = 2000e18;

    function _calcBptOutPerMainIn(
        uint256 mainIn,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 rate,
        uint256 bptSupply
    ) internal pure returns (uint256) {
        if (bptSupply == 0) {
            return _toNominal(mainIn);
        }

        uint256 previousNominalMain = _toNominal(mainBalance);
        uint256 afterNominalMain = _toNominal(mainBalance.add(mainIn));
        uint256 deltaNominalMain = afterNominalMain.sub(previousNominalMain);
        uint256 invariant = _calcInvariant(previousNominalMain, wrappedBalance, rate);
        uint256 newBptSupply = bptSupply.mulUp(FixedPoint.ONE.add(deltaNominalMain.divUp(invariant)));
        return newBptSupply.sub(bptSupply);
    }

    function _calcBptInPerMainOut(
        uint256 mainOut,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 rate,
        uint256 bptSupply
    ) internal pure returns (uint256) {
        uint256 previousNominalMain = _toNominal(mainBalance);
        uint256 afterNominalMain = _toNominal(mainBalance.sub(mainOut));
        uint256 deltaNominalMain = previousNominalMain.sub(afterNominalMain);
        uint256 invariant = _calcInvariant(previousNominalMain, wrappedBalance, rate);
        uint256 newBptSupply = bptSupply.mulUp(FixedPoint.ONE.sub(deltaNominalMain.divUp(invariant)));
        return bptSupply.sub(newBptSupply);
    }

    function _calcWrappedOutPerMainIn(
        uint256 mainIn,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 rate
    ) internal pure returns (uint256) {
        uint256 previousNominalMain = _toNominal(mainBalance);
        uint256 afterNominalMain = _toNominal(mainBalance.add(mainIn));
        uint256 deltaNominalMain = afterNominalMain.sub(previousNominalMain);
        uint256 newWrappedBalance = wrappedBalance.sub(deltaNominalMain.mulUp(rate));
        return wrappedBalance.sub(newWrappedBalance);
    }

    function _calcWrappedInPerMainOut(
        uint256 mainOut,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 rate
    ) internal pure returns (uint256) {
        uint256 previousNominalMain = _toNominal(mainBalance);
        uint256 afterNominalMain = _toNominal(mainBalance.sub(mainOut));
        uint256 deltaNominalMain = previousNominalMain.sub(afterNominalMain);
        uint256 newWrappedBalance = wrappedBalance.add(deltaNominalMain.mulUp(rate));
        return newWrappedBalance.sub(wrappedBalance);
    }

    function _calcMainInPerBptOut(
        uint256 bptOut,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 rate,
        uint256 bptSupply
    ) internal pure returns (uint256) {
        if (bptSupply == 0) {
            return _fromNominal(bptOut);
        }

        uint256 previousNominalMain = _toNominal(mainBalance);
        uint256 invariant = _calcInvariant(previousNominalMain, wrappedBalance, rate);
        uint256 deltaNominalMain = invariant.mulUp(bptOut).divUp(bptSupply);
        uint256 afterNominalMain = previousNominalMain.add(deltaNominalMain);
        uint256 newMainBalance = _fromNominal(afterNominalMain);
        return newMainBalance.sub(mainBalance);
    }

    function _calcMainOutPerBptIn(
        uint256 bptIn,
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 rate,
        uint256 bptSupply
    ) internal pure returns (uint256) {
        uint256 previousNominalMain = _toNominal(mainBalance);
        uint256 invariant = _calcInvariant(previousNominalMain, wrappedBalance, rate);
        uint256 deltaNominalMain = invariant.mulUp(bptIn).divUp(bptSupply);
        uint256 afterNominalMain = previousNominalMain.sub(deltaNominalMain);
        uint256 newMainBalance = _fromNominal(afterNominalMain);
        return mainBalance.sub(newMainBalance);
    }

    function _calcMainOutPerWrappedIn(
        uint256 wrappedIn,
        uint256 mainBalance,
        uint256 rate
    ) internal pure returns (uint256) {
        uint256 previousNominalMain = _toNominal(mainBalance);
        uint256 deltaNominalMain = wrappedIn.mulUp(rate);
        uint256 afterNominalMain = previousNominalMain.sub(deltaNominalMain);
        uint256 newMainBalance = _fromNominal(afterNominalMain);
        return mainBalance.sub(newMainBalance);
    }

    function _calcMainInPerWrappedOut(
        uint256 wrappedOut,
        uint256 mainBalance,
        uint256 rate
    ) internal pure returns (uint256) {
        uint256 previousNominalMain = _toNominal(mainBalance);
        uint256 deltaNominalMain = wrappedOut.mulUp(rate);
        uint256 afterNominalMain = previousNominalMain.add(deltaNominalMain);
        uint256 newMainBalance = _fromNominal(afterNominalMain);
        return newMainBalance.sub(mainBalance);
    }

    function _calcInvariant(
        uint256 mainBalance,
        uint256 wrappedBalance,
        uint256 rate
    ) internal pure returns (uint256) {
        return mainBalance.add(wrappedBalance.mulUp(rate));
    }

    function _toNominal(uint256 amount) internal pure returns (uint256) {
        if (amount < (FixedPoint.ONE - FEE).mulUp(TARGET_1)) {
            return amount.divUp(FixedPoint.ONE - FEE);
        } else if (amount < (TARGET_2 - FEE).mulUp(TARGET_1)) {
            return amount.add(FEE.mulUp(TARGET_1));
        } else {
            return amount.add((TARGET_1 + TARGET_2).mulUp(FEE)).divUp(FixedPoint.ONE + FEE);
        }
    }

    function _fromNominal(uint256 nominal) internal pure returns (uint256) {
        if (nominal < TARGET_1) {
            return nominal.mulUp(FixedPoint.ONE - FEE);
        } else if (nominal < TARGET_2) {
            return nominal.sub(FEE.mulUp(TARGET_1));
        } else {
            return nominal.mulUp(FixedPoint.ONE + FEE).sub(FEE.mulUp(TARGET_1 + TARGET_2));
        }
    }
}
