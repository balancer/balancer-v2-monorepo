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

// Functionality required is onDeposit it needs to pull ERC20s out
// of users wallet and transfer into Euler protocol. Similar
// to on withdrawl. it needs to pull funds from EulerProtocol
// and send back to users wallet (the underlying token)

import "../relayer/interfaces/IMockEulerProtocol.sol";

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IEulerToken.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

/**
 * @notice Allows users to to `deposit` into and `withdraw` from an eToken. The eToken
 * serves as a receipt Token.
 */
contract MockEulerToken is IEulerToken, TestToken {
    using FixedPoint for uint256;

    uint256 public exchangeRateMultiplier;
    //solhint-disable-next-line private-vars-leading-underscore
    uint256 private constant MAX_UINT256 = type(uint256).max;

    //solhint-disable-next-line var-name-mixedcase
    IMockEulerProtocol public immutable EULER_PROTOCOL;

    address private immutable _underlying;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlying,
        IMockEulerProtocol eulerProtocol
    ) TestToken(name, symbol, decimals) {
        exchangeRateMultiplier = FixedPoint.ONE;
        _underlying = underlying;
        EULER_PROTOCOL = eulerProtocol;
    }

    /// @inheritdoc IEulerToken
    function convertBalanceToUnderlying(uint256 balance) public view override returns (uint256) {
        return balance.mulUp(exchangeRateMultiplier);
    }

    function setExchangeRateMultiplier(uint256 _exchangeRateMultiplier) external {
        exchangeRateMultiplier = _exchangeRateMultiplier;
    }

    /// @inheritdoc IEulerToken
    function convertUnderlyingToBalance(uint256 balance) public view override returns (uint256) {
        return balance.divDown(exchangeRateMultiplier);
    }

    /// @inheritdoc IEulerToken
    function underlyingAsset() external view override returns (address) {
        return _underlying;
    }

    /// @inheritdoc IEulerToken
    function deposit(uint256, uint256 amount) external override {
        // The Relayer only uses one account, so no subAccountID required
        // The subAccountID is set to zero in the relayer.
        // Transfer underlying tokens from sender to the Euler pool, and increase account's eTokens

        // assumes Euler protocol has approval to move `amount` from users wallet
        // mints MockEulerTokens to msg.sender (which is the relayer)
        // the relayer has earlier used `_pullToken` to ensure it is the contract
        // which is calling `deposit` on an eToken.
        EULER_PROTOCOL.requestUnderlyingFromRelayer(_underlying, amount, msg.sender);
        _mint(msg.sender, convertUnderlyingToBalance(amount));
    }

    /// @inheritdoc IEulerToken
    function withdraw(uint256, uint256 amount) external override {
        uint256 wrappedAmount;

        if (amount == MAX_UINT256) {
            // MAX_UINT indicates that the sender's full balance of wrappedToken should be redeemed.
            wrappedAmount = balanceOf(msg.sender);
            amount = convertBalanceToUnderlying(wrappedAmount);
        } else {
            wrappedAmount = convertUnderlyingToBalance(amount);
        }

        EULER_PROTOCOL.sendUnderlyingToRelayer(_underlying, amount, msg.sender);
        _burn(msg.sender, wrappedAmount);
    }
}
