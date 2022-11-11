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

import "../compound/ICToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

contract MockCToken is TestToken, ICToken /*ILendingPool*/ {
    address private immutable _underlying;
    uint256 private _rate = 1e8;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset
    ) TestToken(name, symbol, decimals) {
        _underlying = underlyingAsset;
    }

    function underlying() external view override returns (address) {
        return _underlying;
    }

    function exchangeRateStored() external view override returns (uint256) {
        return _rate;
    }

    function setExchangeRateStored(uint256 newRate) external {
        _rate = newRate;
    }

    function mint(
        uint256
    ) external pure override returns (uint256) {
        return 0;
    }

    function redeem(
        uint256
    ) external pure override returns (uint256) {
        return 0;
    }




}