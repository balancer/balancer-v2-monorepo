// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2015, 2016, 2017 Dapphub

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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IstETH.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IwstETH.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";

contract MockWstETH is ERC20, IwstETH {
    using FixedPoint for uint256;

    IstETH public override stETH;
    uint256 public rate = 1.5e18;

    constructor(IstETH token) ERC20("Wrapped Staked Ether", "wstETH") {
        stETH = token;
    }

    function wrap(uint256 _stETHAmount) external override returns (uint256) {
        stETH.transferFrom(msg.sender, address(this), _stETHAmount);
        uint256 wstETHAmount = getWstETHByStETH(_stETHAmount);
        _mint(msg.sender, wstETHAmount);
        return wstETHAmount;
    }

    function unwrap(uint256 _wstETHAmount) external override returns (uint256) {
        _burn(msg.sender, _wstETHAmount);
        uint256 stETHAmount = getStETHByWstETH(_wstETHAmount);
        stETH.transfer(msg.sender, stETHAmount);
        return stETHAmount;
    }

    receive() external payable {
        stETH.submit{ value: msg.value }(address(this));
        _mint(msg.sender, getWstETHByStETH(msg.value));
    }

    function getWstETHByStETH(uint256 _stETHAmount) public view override returns (uint256) {
        return _stETHAmount.divDown(rate);
    }

    function getStETHByWstETH(uint256 _wstETHAmount) public view override returns (uint256) {
        return _wstETHAmount.mulDown(rate);
    }

    function stEthPerToken() external view override returns (uint256) {
        return getStETHByWstETH(1 ether);
    }

    function tokensPerStEth() external view override returns (uint256) {
        return getWstETHByStETH(1 ether);
    }
}
