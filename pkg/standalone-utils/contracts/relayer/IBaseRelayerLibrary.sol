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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-vault/contracts/AssetHelpers.sol";

/**
 * @title IBaseRelayerLibrary
 */
abstract contract IBaseRelayerLibrary is AssetHelpers {
    constructor(IWETH weth) AssetHelpers(weth) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function getVault() public view virtual returns (IVault);

    function approveVault(IERC20 token, uint256 amount) public virtual;

    function _pullToken(
        address sender,
        IERC20 token,
        uint256 amount
    ) internal virtual;

    function _pullTokens(
        address sender,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) internal virtual;

    function _isChainedReference(uint256 amount) internal pure virtual returns (bool);

    function _setChainedReferenceValue(uint256 ref, uint256 value) internal virtual;

    function _getChainedReferenceValue(uint256 ref) internal virtual returns (uint256);
}
