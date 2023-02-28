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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ICFuseToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

contract MockCToken is TestToken, ICFuseToken {
    address public immutable override underlying;
    uint256 private _exchangeRate;
    uint256 private _temp;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingAsset,
        uint256 exchangeRate
    ) TestToken(name, symbol, decimals) {
        underlying = underlyingAsset;
        _exchangeRate = exchangeRate;
    }

    /**
     * @notice Sender supplies assets into the market and receives cTokens in exchange
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param mintAmount The amount of the underlying asset to supply
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function mint(uint256 mintAmount) public override returns (uint256) {
        uint256 amountToMint = mintAmount;

        ERC20(underlying).transferFrom(msg.sender, address(this), mintAmount);

        _mint(msg.sender, amountToMint);

        return 0;
    }

    function mintCTokens(address receiver, uint256 mintAmount) public {
        _mint(receiver, mintAmount);
    }

    /**
     * @notice Sender redeems cTokens in exchange for the underlying asset
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param redeemTokens The number of cTokens to redeem into underlying
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function redeem(uint256 redeemTokens) external override returns (uint256) {
        _burn(msg.sender, redeemTokens);

        uint256 amountToReturn = redeemTokens;

        ERC20(underlying).transfer(msg.sender, amountToReturn);

        return 0;
    }

    /**
     * @notice preview amount of CTokens returned 
     * @param amount The number of underlying Tokens expected to be exchanged
     * @return amount of CTokens returned for amount of Token depoisted 
     */
    function toCTokenAmount(uint256 amount) public pure returns(uint256) {
        return amount;
    }
    /**
     * @notice preview amount of underlying returned
     * @param amount The number of underlying Tokens expected to be exchanged
     * @return amount of CTokens returned for amount of Token depoisted 
     */
    function fromCTokenAmount(uint256 amount) public pure returns(uint256) {
        return amount;
    }

    function exchangeRateCurrent() external view override returns (uint256) {
        return _exchangeRate;
    }

    function exchangeRateStored() external view override returns (uint256) {
        return _exchangeRate;
    }

    function setExchangeRate(uint256 newExchangeRate) public {
        _exchangeRate = newExchangeRate;
    }

    function accrueInterest() external returns (uint256) {
        _temp = 1;

        return 0;
    }

    function accrualBlockNumber() external pure override returns (uint256) {
        return 100000;
    }

    function initialExchangeRateMantissa() external pure override returns (uint256) {
        return 2e17;
    }

    function reserveFactorMantissa() external pure override returns (uint256) {
        return 0;
    }

    function totalAdminFees() external pure override returns (uint256) {
        return 0;
    }

    function totalFuseFees() external pure override returns (uint256) {
        return 0;
    }

    function totalBorrows() external pure override returns (uint256) {
        return 1e18;
    }

    function totalReserves() external pure override returns (uint256) {
        return 2e18;
    }
}