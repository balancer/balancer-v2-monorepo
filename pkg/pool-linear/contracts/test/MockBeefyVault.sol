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
contract MockBeefyVault is TestToken {
    address public immutable want;
    uint256 private _balance;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset
    ) TestToken(name, symbol, decimals) {
        want = underlyingAsset;
    }

    function balance() external view returns (uint256) {
        return _balance;
    }

    function setBalance(uint256 _newBalance) public {
        _balance = _newBalance;
    }

    function setTotalSupply(uint256 _newTotalSupply) public {
        _mint(msg.sender, _newTotalSupply);
    }

    function deposit(uint256 _amount) public {
        ERC20(want).transferFrom(msg.sender, address(this), _amount);

        uint256 amountToMint = _amount * totalSupply() / _balance;
        _balance += _amount;
        
        _mint(msg.sender, amountToMint);
        
    }

    function withdraw(uint256 _shares) public {
        uint256 amountToReturn = _shares * _balance / totalSupply();
        _burn(msg.sender, _shares);
        _balance -= amountToReturn;

        ERC20(want).transfer(msg.sender, amountToReturn);
    }
}