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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerTokenAdmin.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeController.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IMainnetBalancerMinter.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";

import "../BalancerMinter.sol";

contract MockBalancerMinter is BalancerMinter {
    event MintFor(address gauge, address user);
    event MintForMany(address[] gauges, address user);

    uint256 private _mintForReturn;
    uint256 private _mintForManyReturn;

    constructor(IERC20 token) BalancerMinter(token, "Balancer Minter", "1") {
        // solhint-disable-previous-line no-empty-blocks
    }

    function setMockMintFor(uint256 mintForReturn) external {
        _mintForReturn = mintForReturn;
    }

    function setMockMintForMany(uint256 mintForManyReturn) external {
        _mintForManyReturn = mintForManyReturn;
    }

    function setMinted(
        address user,
        address gauge,
        uint256 value
    ) external {
        return _setMinted(user, gauge, value);
    }

    // Internal functions

    function _mintFor(address gauge, address user) internal override returns (uint256 tokensToMint) {
        emit MintFor(gauge, user);
        return _mintForReturn;
    }

    function _mintForMany(address[] calldata gauges, address user) internal override returns (uint256 tokensToMint) {
        emit MintForMany(gauges, user);
        return _mintForManyReturn;
    }
}
