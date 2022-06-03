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

import "../RecoveryMode.sol";

contract MockRecoveryMode is RecoveryMode {
    constructor(address owner) BasePoolAuthorization(owner) Authentication(bytes32(uint256(address(this)))) {
      // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Compute the tokens out, given the pool balances, total supply, and BPT in
     */
    function computeProportionalAmountsOut(
        uint256[] memory balances,
        uint256 totalSupply,
        uint256 bptAmountIn
    ) external pure returns (uint256[] memory amountsOut) {
      return super._computeProportionalAmountsOut(balances, totalSupply, bptAmountIn);
    }

    function _getAuthorizer() internal pure override returns (IAuthorizer) {
      return IAuthorizer(address(0));
    }

    function _isOwnerOnlyAction(bytes32) internal pure override returns (bool) {
      return false;
    }
}
