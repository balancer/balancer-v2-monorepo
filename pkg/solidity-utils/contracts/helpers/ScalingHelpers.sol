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

import "../math/FixedPoint.sol";
import "../math/Math.sol";
import "../openzeppelin/ERC20.sol";
import "./InputHelpers.sol";

// solhint-disable

// To simplify Pool logic, all token balances and amounts are normalized to behave as if the token had 18 decimals.
// e.g. When comparing DAI (18 decimals) and USDC (6 decimals), 1 USDC and 1 DAI would both be represented as 1e18,
// whereas without scaling 1 USDC would be represented as 1e6.
// This allows us to not consider differences in token decimals in the internal Pool maths, simplifying it greatly.

// Single Value

/**
 * @dev Applies `scalingFactor` to `amount`, resulting in a larger or equal value depending on whether it needed
 * scaling or not.
 */
function _upscale(uint256 amount, uint256 scalingFactor) pure returns (uint256) {
    // Upscale rounding wouldn't necessarily always go in the same direction: in a swap for example the balance of
    // token in should be rounded up, and that of token out rounded down. This is the only place where we round in
    // the same direction for all amounts, as the impact of this rounding is expected to be minimal.
    return FixedPoint.mulDown(amount, scalingFactor);
}

/**
 * @dev Reverses the `scalingFactor` applied to `amount`, resulting in a smaller or equal value depending on
 * whether it needed scaling or not. The result is rounded down.
 */
function _downscaleDown(uint256 amount, uint256 scalingFactor) pure returns (uint256) {
    return FixedPoint.divDown(amount, scalingFactor);
}

/**
 * @dev Reverses the `scalingFactor` applied to `amount`, resulting in a smaller or equal value depending on
 * whether it needed scaling or not. The result is rounded up.
 */
function _downscaleUp(uint256 amount, uint256 scalingFactor) pure returns (uint256) {
    return FixedPoint.divUp(amount, scalingFactor);
}

// Array

/**
 * @dev Same as `_upscale`, but for an entire array. This function does not return anything, but instead *mutates*
 * the `amounts` array.
 */
function _upscaleArray(uint256[] memory amounts, uint256[] memory scalingFactors) pure {
    uint256 length = amounts.length;
    InputHelpers.ensureInputLengthMatch(length, scalingFactors.length);

    for (uint256 i = 0; i < length; ++i) {
        amounts[i] = FixedPoint.mulDown(amounts[i], scalingFactors[i]);
    }
}

/**
 * @dev Same as `_downscaleDown`, but for an entire array. This function does not return anything, but instead
 * *mutates* the `amounts` array.
 */
function _downscaleDownArray(uint256[] memory amounts, uint256[] memory scalingFactors) pure {
    uint256 length = amounts.length;
    InputHelpers.ensureInputLengthMatch(length, scalingFactors.length);

    for (uint256 i = 0; i < length; ++i) {
        amounts[i] = FixedPoint.divDown(amounts[i], scalingFactors[i]);
    }
}

/**
 * @dev Same as `_downscaleUp`, but for an entire array. This function does not return anything, but instead
 * *mutates* the `amounts` array.
 */
function _downscaleUpArray(uint256[] memory amounts, uint256[] memory scalingFactors) pure {
    uint256 length = amounts.length;
    InputHelpers.ensureInputLengthMatch(length, scalingFactors.length);

    for (uint256 i = 0; i < length; ++i) {
        amounts[i] = FixedPoint.divUp(amounts[i], scalingFactors[i]);
    }
}

function _computeScalingFactor(IERC20 token) view returns (uint256) {
    // Tokens that don't implement the `decimals` method are not supported.
    uint256 tokenDecimals = ERC20(address(token)).decimals();

    // Tokens with more than 18 decimals are not supported.
    uint256 decimalsDifference = Math.sub(18, tokenDecimals);
    return FixedPoint.ONE * 10**decimalsDifference;
}
