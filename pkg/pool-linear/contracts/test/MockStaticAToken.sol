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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IStaticAToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

contract MockStaticAToken is TestToken, IStaticAToken, ILendingPool {
    uint256 private _rate = 1e27;
    address private immutable _ASSET;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset
    ) TestToken(name, symbol, decimals) {
        _ASSET = underlyingAsset;
    }

    // solhint-disable-next-line func-name-mixedcase
    function ASSET() external view override returns (address) {
        return _ASSET;
    }

    // solhint-disable-next-line func-name-mixedcase
    function LENDING_POOL() external view override returns (ILendingPool) {
        return ILendingPool(this);
    }

    function rate() external pure override returns (uint256) {
        revert("Should not call this");
    }

    function getReserveNormalizedIncome(address) external view override returns (uint256) {
        return _rate;
    }

    function setReserveNormalizedIncome(uint256 newRate) external {
        _rate = newRate;
    }
}
