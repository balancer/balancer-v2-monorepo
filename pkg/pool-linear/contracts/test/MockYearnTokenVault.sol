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

import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

//we're unable to implement IYearnTokenVault because it defines the decimals function, which collides with
//the TestToken ERC20 implementation
contract MockYearnTokenVault is TestToken {
    address private immutable _token;
    uint256 private immutable _pricePerShare;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset,
        uint256 sharePrice
    ) TestToken(name, symbol, decimals) {
        _token = underlyingAsset;
        _pricePerShare = sharePrice;
    }

    function token() external view returns (address) {
        return _token;
    }

    function pricePerShare() external view returns (uint256) {
        return _pricePerShare;
    }
}