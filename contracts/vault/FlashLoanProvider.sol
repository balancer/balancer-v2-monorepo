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
import "hardhat/console.sol";
import "../math/FixedPoint.sol";
import "./IFlashLoanReceiver.sol";
import "./IVault.sol";
import "./Settings.sol";

abstract contract FlashLoanProvider is IVault, Settings {
    using FixedPoint for uint256;

    /**
     * @dev emitted when a flashloan is executed
     * @param _target the address of the flashLoanReceiver
     * @param _token the address of the ERC20 token
     * @param _amount the amount requested
     * @param _fee the fee on the amount
     * @param _timestamp the timestamp of the action
     **/
    event FlashLoan(
        address indexed _target,
        address indexed _token,
        uint256 _amount,
        uint256 _fee,
        uint256 _timestamp
    );

    /**
     * @dev allows smartcontracts to access the liquidity of the vault within one transaction,
     * as long as the amount taken plus a fee is returned. NOTE There are security concerns for developers of flashloan
     * receiver contracts that must be kept into consideration.
     * For further details please visit https://developers.aave.com
     * @param _receiver The address of the contract receiving the funds. The receiver should implement the
     * IFlashLoanReceiver interface.
     * @param _token the address of the principal ERC-20 token
     * @param _amount the amount requested for this flashloan
     **/
    function flashLoan(
        address _receiver,
        address _token,
        uint256 _amount,
        bytes memory _params //TODO check for reentrancy
    ) external override {
        //check that the token has enough available liquidity
        uint256 availableLiquidityBefore = IERC20(_token).balanceOf(
            address(this)
        );

        require(
            availableLiquidityBefore >= _amount,
            "There is not enough liquidity available to borrow"
        );

        //calculate fee on amount
        uint256 amountFee = _calculateProtocolFlashLoanFee(_amount);
        require(
            amountFee > 0,
            "The requested amount is too small for a flashLoan."
        );

        //get the FlashLoanReceiver instance
        IFlashLoanReceiver receiver = IFlashLoanReceiver(_receiver);

        address payable userPayable = address(uint160(_receiver));

        //transfer funds to the receiver
        IERC20(_token).transfer(userPayable, _amount);

        //execute action of the receiver
        receiver.executeOperation(_token, _amount, amountFee, _params);

        //check that the actual balance of the core contract includes the returned amount
        uint256 availableLiquidityAfter = IERC20(_token).balanceOf(
            address(this)
        );

        require(
            availableLiquidityAfter == availableLiquidityBefore.add(amountFee),
            "The actual balance of the protocol is inconsistent"
        );

        emit FlashLoan(_receiver, _token, _amount, amountFee, block.timestamp);
    }
}
