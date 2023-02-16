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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "../relayer/interfaces/IMockEulerToken.sol";
import "../relayer/interfaces/IMockEulerProtocol.sol";

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

contract MockEulerToken is IEulerToken, TestToken {
    // from Euler docs:
    // in order to invest an asset to earn interest, you need to `deposit` into an eToken

    uint256 public exchangeRateMultiplier;

    // solhint-disable-next-line var-name-mixedcase
    address public immutable ASSET;
    address public immutable EULER_PROTOCOL;

    uint256 private _onlyForMockStorage;
    address private _mockMsgSender;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address asset,
        address eulerProtocol
    ) TestToken(name, symbol, decimals) {
        exchangeRateMultiplier = 1;
        ASSET = asset;
        EULER_PROTOCOL = eulerProtocol;
    }

    // convert eToken Balance to underlying
    function convertBalanceToUnderlying(uint256 balance) external override view returns (uint256) {
        return balance * exchangeRateMultiplier;
    }

    function setExchangeRateMultiplier(uint256 _exchangeRateMultiplier) external {
        require(_exchangeRateMultiplier < 3, "Cannot set exchangeRateMultiplier bigger 3");
        exchangeRateMultiplier = _exchangeRateMultiplier;
    }

    // convert underlying Balance to eToken
    function convertUnderlyingToBalance(uint256 balance) external override view returns (uint256) {
        return balance * (1/exchangeRateMultiplier);
    }

    function underlyingAsset() external override view returns (address) {
        return ASSET;
    }

    function deposit(uint256 subAccountId, uint256 amount) external override {

        _onlyForMockStorage = subAccountId;
        // Linear Pool only uses one account. Meaning no subAccountID required
        // is set to 0 in the LinearPool
        // Transfer underlying tokens from sender to the Euler pool, and increase account's eTokens

        // assumes Euler protocol has approval to move `amount` from users wallet
        // mints MockEulerTokens to msg.sender (which is the relayer)
        // the relayer has earlier used `_pullToken` to ensure it is the contract
        // which is calling `deposit` on an eToken.

        _mockMsgSender = msg.sender;

        IMockEulerProtocol(EULER_PROTOCOL).requestUnderlyingFromRelayer(address(ASSET), amount, _mockMsgSender); 

        _mint(msg.sender, amount);
    }

    function withdraw(uint256 subAccountId, uint256 amount) external override {

        _onlyForMockStorage = subAccountId;

        // EulerWrapping will pass MAX_UINT as this allows to exchange all wrappedTokens
        // for maximum amount of mainTokens
        // this mock transforms the amount to be the balanceOf mockEulerTokens in the relayer
        // so that the appropriate amount can be transferedFrom via the mockEulerProtocol
        amount = this.balanceOf(msg.sender);

        // request tokens from Euler protocol and send to the Relayer
        _mockMsgSender = msg.sender;
        IMockEulerProtocol(EULER_PROTOCOL).sendUnderlyingToRelayer(ASSET, amount, _mockMsgSender);
        _burn(msg.sender, amount);
    }
}