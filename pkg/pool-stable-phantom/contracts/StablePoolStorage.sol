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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";

import "./StableMath.sol";
import "hardhat/console.sol";

abstract contract StablePoolStorage is BasePool {
    using FixedPoint for uint256;

    // This minimum refers not to the total tokens, but rather to the non-BPT tokens. The minimum value for _totalTokens
    // is therefore _MIN_TOKENS + 1.
    uint256 private constant _MIN_TOKENS = 2;

    // The Pool will register n+1 tokens, where n are the actual tokens in the Pool, and the other one is the BPT
    // itself.
    uint256 private immutable _totalTokens;

    // The index of BPT in the tokens and balances arrays, i.e. its index when calling IVault.registerTokens().
    uint256 private immutable _bptIndex;

    // These are the registered tokens: one of them will be the BPT.
    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;
    IERC20 internal immutable _token3;
    IERC20 internal immutable _token4;
    IERC20 internal immutable _token5;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;
    uint256 internal immutable _scalingFactor4;
    uint256 internal immutable _scalingFactor5;

    constructor(IERC20[] memory registeredTokens) {
        // BasePool checks that the Pool has at least two tokens, but since one of them is the BPT (this contract), we
        // need to check ourselves that there are at least creator-supplied tokens (i.e. the minimum number of total
        // tokens for this contract is actually three, including the BPT).
        uint256 totalTokens = registeredTokens.length;
        _require(totalTokens > _MIN_TOKENS, Errors.MIN_TOKENS);

        _totalTokens = totalTokens;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = registeredTokens[0];
        _token1 = registeredTokens[1];
        _token2 = registeredTokens[2];
        _token3 = totalTokens > 3 ? registeredTokens[3] : IERC20(0);
        _token4 = totalTokens > 4 ? registeredTokens[4] : IERC20(0);
        _token5 = totalTokens > 5 ? registeredTokens[5] : IERC20(0);

        _scalingFactor0 = _computeScalingFactor(registeredTokens[0]);
        _scalingFactor1 = _computeScalingFactor(registeredTokens[1]);
        _scalingFactor2 = _computeScalingFactor(registeredTokens[2]);
        _scalingFactor3 = totalTokens > 3 ? _computeScalingFactor(registeredTokens[3]) : 0;
        _scalingFactor4 = totalTokens > 4 ? _computeScalingFactor(registeredTokens[4]) : 0;
        _scalingFactor5 = totalTokens > 5 ? _computeScalingFactor(registeredTokens[5]) : 0;

        // The Vault keeps track of all Pool tokens in a specific order: we need to know what the index of BPT is in
        // this ordering to be able to identify it when balances arrays are received. Since the tokens array is sorted,
        // we need to find the correct BPT index in the array returned by `_insertSorted()`.
        // See `IVault.getPoolTokens()` for more information regarding token ordering.
        uint256 bptIndex;
        for (
            bptIndex = registeredTokens.length - 1;
            bptIndex > 0 && registeredTokens[bptIndex] > IERC20(this);
            bptIndex--
        ) {
            // solhint-disable-previous-line no-empty-blocks
        }
        _bptIndex = bptIndex;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        // The BPT will be one of the Pool tokens, but it is unaffected by the Stable 5 token limit.
        return StableMath._MAX_STABLE_TOKENS + 1;
    }

    function getBptIndex() public view returns (uint256) {
        return _bptIndex;
    }

    // Convert from an index into an array including BPT (the Vault's registered token list), to an index
    // into an array excluding BPT (usually from user input, such as amountsIn/Out).
    // `index` must not be the BPT token index itself.
    function _skipBptIndex(uint256 index) internal view returns (uint256) {
        // Currently this is never called with an index passed in from user input, so this check
        // should not be necessary. Included for completion (and future proofing).
        _require(index != getBptIndex(), Errors.OUT_OF_BOUNDS);

        return index < getBptIndex() ? index : index.sub(1);
    }

    // Convert from an index into an array excluding BPT (usually from user input, such as amountsIn/Out),
    // to an index into an array excluding BPT (the Vault's registered token list).
    // `index` must not be the BPT token index itself, if it is the last element, and the result must be
    // in the range of registered tokens.
    function _addBptIndex(uint256 index) internal view returns (uint256 indexWithBpt) {
        // This can be called from an index passed in from user input.
        indexWithBpt = index < getBptIndex() ? index : index.add(1);

        _require(indexWithBpt < _totalTokens && indexWithBpt != getBptIndex(), Errors.OUT_OF_BOUNDS);
    }

    /**
     * @dev Remove the item at `_bptIndex` from an arbitrary array (e.g., amountsIn).
     */
    function _dropBptItem(uint256[] memory amounts) internal view returns (uint256[] memory) {
        uint256[] memory amountsWithoutBpt = new uint256[](amounts.length - 1);
        for (uint256 i = 0; i < amountsWithoutBpt.length; i++) {
            amountsWithoutBpt[i] = amounts[i < getBptIndex() ? i : i + 1];
        }

        return amountsWithoutBpt;
    }

    function _getScalingFactor0() internal view returns (uint256) {
        return _scalingFactor0;
    }

    function _getScalingFactor1() internal view returns (uint256) {
        return _scalingFactor1;
    }

    function _getScalingFactor2() internal view returns (uint256) {
        return _scalingFactor2;
    }

    function _getScalingFactor3() internal view returns (uint256) {
        return _scalingFactor3;
    }

    function _getScalingFactor4() internal view returns (uint256) {
        return _scalingFactor4;
    }

    function _getScalingFactor5() internal view returns (uint256) {
        return _scalingFactor5;
    }
}
