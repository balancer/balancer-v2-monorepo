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

import "../relayer/RelayerAssetHelpers.sol";

contract RelayerAssetHelpersMock is RelayerAssetHelpers {
    constructor(IVault vault) RelayerAssetHelpers(vault) {}

    function approveToken(
        IERC20 token,
        address spender,
        uint256 amount
    ) external {
        _approveToken(token, spender, amount);
    }

    function sweepETH() external {
        _sweepETH();
    }

    function pullToken(
        address sender,
        IERC20 token,
        uint256 amount
    ) external {
        _pullToken(sender, token, amount);
    }

    function pullTokens(
        address sender,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) external {
        _pullTokens(sender, tokens, amounts);
    }
}
