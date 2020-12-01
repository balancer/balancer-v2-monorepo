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

// This flash loan provider was based on the Aave protocol's open source
// implementation and terminology and interfaces are intentionally kept
// similar

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./IFlashLoanReceiver.sol";
import "./IVault.sol";
import "./Settings.sol";

import "../math/FixedPoint.sol";

abstract contract FlashLoanProvider is ReentrancyGuard, IVault, Settings {
    using FixedPoint for uint256;

    /**
     * @dev allows smartcontracts to access the liquidity of the vault within one transaction,
     **/
    function flashLoan(
        IFlashLoanReceiver receiver,
        IERC20 token,
        uint256 amount,
        bytes calldata userData
    ) external override nonReentrant {
        //check that the token has enough available liquidity
        uint256 availableLiquidityBefore = token.balanceOf(address(this));

        require(availableLiquidityBefore >= amount, "There is not enough liquidity available to borrow");

        //calculate fee on amount
        uint256 amountFee = _calculateProtocolFlashLoanFee(amount);

        //transfer funds to the receiver
        IERC20(token).transfer(address(receiver), amount);

        //execute action of the receiver
        receiver.executeOperation(token, amount, amountFee, userData);

        //check that the actual balance of the core contract includes the returned amount
        uint256 availableLiquidityAfter = IERC20(token).balanceOf(address(this));

        require(
            availableLiquidityAfter == availableLiquidityBefore.add(amountFee),
            "The actual balance of the protocol is inconsistent"
        );
    }
}
