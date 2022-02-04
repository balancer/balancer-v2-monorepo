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

import "@balancer-labs/v2-standalone-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-solidity-utils/contracts/misc/IERC4626.sol";

contract MockERC4626Token is TestToken, IERC4626 {
    uint256 private _rate = 1e27;
    address private immutable _mainToken;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address mainToken
    ) TestToken(name, symbol, decimals) {
        _mainToken = mainToken;
        _rate = 10 ** decimals;
    }


    function setRate(uint256 newRate) external {
        _rate = newRate;
    }

    function assetsPerShare() external view override returns (uint256){
        return _rate;
    }

    function asset() external view override returns (address){
        return _mainToken;
    }

    function deposit(uint256 assets, address) external override returns (uint256) {
        return assets/_rate;
    }

    function redeem(uint256 shares, address, address) external override returns (uint256) {
        return shares*_rate;
    }
}
