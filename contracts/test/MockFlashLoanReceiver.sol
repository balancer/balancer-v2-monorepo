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

pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../math/FixedPoint.sol";

import "../vault/IVault.sol";
import "../vault/IFlashLoanReceiver.sol";

contract MockFlashLoanReceiver is Ownable, IFlashLoanReceiver {
    using FixedPoint for uint256;
    IVault public vault;
    bool public failExecution = false;

    constructor(address _vault) public Ownable() {
        vault = IVault(_vault);
    }

    receive() external payable {}

    function setFailExecutionTransfer(bool _fail) public {
        failExecution = _fail;
    }

    /**
        This function is called after your contract has received the flash loaned amount
     */
    function executeOperation(
        address _token,
        uint256 _amount,
        uint256 _fee,
        bytes calldata _params
    ) external override {
        require(IERC20(_token).balanceOf(address(this)) >= _amount, "Invalid balance, was the flashLoan successful?");

        if (failExecution) {
            return;
        }
        //
        // Logic goes here.
        //

        uint256 totalDebt = _amount.add(_fee);
        IERC20(_token).transfer(address(vault), totalDebt);
    }

    /**
        Flash loan 1000000000000000000 wei (1 ether) worth of `_asset`
     */
    function flashloan(address _asset) public onlyOwner {
        bytes memory data = "";
        uint256 amount = 10**20; // 100 tokens

        vault.flashLoan(address(this), _asset, amount, data);
    }
}
