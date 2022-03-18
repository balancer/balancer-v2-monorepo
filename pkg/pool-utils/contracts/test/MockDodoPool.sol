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

import "../factories/BasePoolFactory.sol";
import "../interfaces/IDODO.sol";
import "../interfaces/IDODOCallee.sol";

/**
 * @dev Mocks a DODO pool. Test code needs to mint tokens to it.
 */ 
contract MockDodoPool is IDODO {
    IERC20 private immutable _baseToken;
    IERC20 private immutable _quoteToken;

    constructor(IERC20 baseToken, IERC20 quoteToken) {
        _baseToken = baseToken;
        _quoteToken = quoteToken;
    }

    function flashLoan(
        uint256 baseAmount,
        uint256 quoteAmount,
        address assetTo,
        bytes calldata data
    ) external override {
        address loanReceipient = msg.sender;

        require(baseAmount != 0 || quoteAmount != 0, "Invalid flashloan (zero amounts)");
        require(baseAmount == 0 || quoteAmount == 0, "Invalid flashloan (multiple tokens)");

        IERC20 token = baseAmount == 0 ? _quoteToken : _baseToken;

        // Record the balance before the loan
        uint256 balanceBefore = token.balanceOf(address(this));

        // Send the loan tokens
        token.transfer(assetTo, baseAmount + quoteAmount);

        // Callback to process the loan
        IDODOCallee(loanReceipient).DPPFlashLoanCall(loanReceipient, baseAmount, quoteAmount, data);

        // Callee should have returned the tokens
        uint256 balanceAfter = token.balanceOf(address(this));
        require (balanceAfter == balanceBefore, "Flashloan not repaid");
    }

    // solhint-disable-next-line func-name-mixedcase, private-vars-leading-underscore
    function _BASE_TOKEN_() external override view returns (IERC20) {
        return _baseToken;
    }

    // solhint-disable-next-line func-name-mixedcase, private-vars-leading-underscore
    function _QUOTE_TOKEN_() external override view returns (IERC20) {
        return _quoteToken;
    }
}