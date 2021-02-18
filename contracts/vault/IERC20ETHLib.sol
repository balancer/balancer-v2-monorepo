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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IWETH.sol";
import "./interfaces/IERC20ETH.sol";

library IERC20ETHLib {
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    IWETH internal constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    function isETH(IERC20ETH token) internal pure returns (bool) {
        return address(token) == ETH;
    }

    function isNotETH(IERC20ETH token) internal pure returns (bool) {
        return address(token) != ETH;
    }

    function toIERC20(IERC20ETH token) internal pure returns (IERC20) {
        if (isETH(token)) {
            return WETH;
        } else {
            return IERC20(address(token));
        }
    }
}
