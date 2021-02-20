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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IWETH.sol";
import "./interfaces/IERC20ETH.sol";

abstract contract WETHManager {
    IWETH internal immutable WETH;
    address internal constant ETH = address(0);

    constructor(IWETH weth) {
        WETH = weth;
    }

    /**
     * @dev Returns true if `token` is the sentinel value that stands for ETH.
     */
    function _isETH(IERC20ETH token) internal pure returns (bool) {
        return address(token) == ETH;
    }

    /**
     * @dev Translates `token` into an equivalent IERC20 token address. If `token` stands for ETH, it will be translated
     * into the WETH contract.
     */
    function _translateToIERC20(IERC20ETH token) internal view returns (IERC20) {
        if (_isETH(token)) {
            return WETH;
        } else {
            return _asIERC20(token);
        }
    }

    /**
     * @dev Interprets `token` as an IERC20 token. This function should only be called on `token` if `_isETH` previously
     * returned false for it, that is, if `token` is guaranteed to not be the sentinel value that stands for ETH.
     */
    function _asIERC20(IERC20ETH token) internal pure returns (IERC20) {
        return IERC20(address(token));
    }
}
