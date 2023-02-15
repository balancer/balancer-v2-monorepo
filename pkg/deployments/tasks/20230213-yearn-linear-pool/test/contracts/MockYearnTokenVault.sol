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

import "@balancer-labs/v2-pool-utils/contracts/test/MaliciousQueryReverter.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

//we're unable to implement IYearnTokenVault because it defines the decimals function, which collides with
//the TestToken ERC20 implementation
contract MockYearnTokenVault is TestToken, MaliciousQueryReverter {
    address private immutable _token;

    uint256 private _lastReport;
    uint256 private _lockedProfit;
    uint256 private _lockedProfitDegradation;
    uint256 private _totalAssets;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset
    ) TestToken(name, symbol, decimals) {
        _token = underlyingAsset;
        _lockedProfitDegradation = 1e18;
    }

    function token() external view returns (address) {
        return _token;
    }

    function pricePerShare() public view returns (uint256) {
        maybeRevertMaliciously();

        uint256 supply = totalSupply();
        if (supply == 0) {
            return 10**decimals();
        } else {
            return (10**decimals() * _totalAssets) / supply;
        }
    }

    function deposit(uint256 _amount, address recipient) public returns (uint256) {
        ERC20(_token).transferFrom(msg.sender, address(this), _amount);

        uint256 amountToMint = (_amount * 10**decimals()) / pricePerShare();
        _mint(recipient, amountToMint);

        return amountToMint;
    }

    function withdraw(uint256 maxShares, address recipient) public returns (uint256) {
        _burn(msg.sender, maxShares);

        uint256 amountToReturn = (maxShares * pricePerShare()) / 10**decimals();
        ERC20(_token).transfer(recipient, amountToReturn);

        return amountToReturn;
    }

    function lastReport() external view returns (uint256) {
        maybeRevertMaliciously();
        // Doesn't change, but read from storage anyway just to simulate gas cost.
        return _lastReport;
    }

    function lockedProfit() external view returns (uint256) {
        maybeRevertMaliciously();
        // Doesn't change, but read from storage anyway just to simulate gas cost.
        return _lockedProfit;
    }

    function lockedProfitDegradation() external view returns (uint256) {
        maybeRevertMaliciously();
        // Doesn't change, but read from storage anyway just to simulate gas cost.
        return _lockedProfitDegradation;
    }

    function totalAssets() external view returns (uint256) {
        maybeRevertMaliciously();
        return _totalAssets;
    }

    function setTotalAssets(uint256 _newTotalAssets) public {
        _totalAssets = _newTotalAssets;
    }

    function totalSupply() public view virtual override returns (uint256) {
        maybeRevertMaliciously();
        return super.totalSupply();
    }
}
