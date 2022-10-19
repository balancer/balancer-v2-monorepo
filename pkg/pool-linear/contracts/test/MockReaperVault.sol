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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

//we're unable to implement IYearnTokenVault because it defines the decimals function, which collides with
//the TestToken ERC20 implementation
contract MockReaperVault is TestToken {
    using SafeERC20 for IERC20;

    address public immutable token;
    uint256 private _pricePerFullShare;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset,
        uint256 fullSharePrice
    ) TestToken(name, symbol, decimals) {
        token = underlyingAsset;
        _pricePerFullShare = fullSharePrice;
    }

    function getPricePerFullShare() external view returns (uint256) {
        return _pricePerFullShare;
    }

    function setPricePerFullShare(uint256 _newPricePerFullShare) public {
        _pricePerFullShare = _newPricePerFullShare;
    }

    function deposit(uint256 _amount) public {
        IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);

        uint256 amountToMint = _amount * 10**18 / _pricePerFullShare;

        _mint(msg.sender, amountToMint);
    }

    function withdraw(uint256 _shares) public {
        _burn(msg.sender, _shares);

        uint256 amountToReturn = _shares * _pricePerFullShare / 10**18;

        IERC20(token).safeTransfer(msg.sender, amountToReturn);
    }
}