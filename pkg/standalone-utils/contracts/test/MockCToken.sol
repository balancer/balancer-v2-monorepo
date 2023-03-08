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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ICToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

contract MockCToken is TestToken, ICToken {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    address private immutable _underlying;
    uint256 private immutable _scaleFactor;

    uint256 private _exchangeRate;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset,
        uint256 exchangeRate
    ) TestToken(name, symbol, 8) { // cTokens always have 8 decimals
        _underlying = underlyingAsset;

        // Scale the exchange rate to 1e(18-8+underlyingDecimals).
        uint256 scaleFactor = 10**(uint256(10).add(ERC20(underlyingAsset).decimals()));
        _scaleFactor = scaleFactor;

        // Incoming exchange rate is scaled to 1e18.
        _exchangeRate = exchangeRate.mulDown(scaleFactor);
    }

    /// @inheritdoc ICToken
    function underlying() external view override returns (address) {
        return _underlying;
    }

    /// @inheritdoc ICToken
    function mint(uint256 mintAmount) external override returns (uint256) {
        uint256 amountToMint = toCTokenAmount(mintAmount);

        IERC20(_underlying).safeTransferFrom(msg.sender, address(this), mintAmount);

        _mint(msg.sender, amountToMint);

        return 0;
    }

    /// @inheritdoc ICToken
    function redeem(uint256 redeemTokens) external override returns (uint256) {
        _burn(msg.sender, redeemTokens);

        uint256 amountToReturn = fromCTokenAmount(redeemTokens);

        IERC20(_underlying).safeTransfer(msg.sender, amountToReturn);

        return 0;
    }

    /**
     * @notice Mint cTokens directly without depositing underlying assets.
     * @dev This is required for testing because Compound's `mint` function overrides `TestToken.mint`.
     */
    function mintTestTokens(address receiver, uint256 mintAmount) external {
        _mint(receiver, mintAmount);
    }

    /**
     * @notice Preview the amount of underlying returned by a withdrawal.
     * @param amount The number of cTokens to be redeemed.
     * @return The number of underlying tokens returned.
     */
    function fromCTokenAmount(uint256 amount) public view returns (uint256) {
        return amount.mulUp(_exchangeRate);
    }

    /**
     * @notice Preview the amount of cTokens returned by a deposit.
     * @param amount The number of underlying tokens to be deposited.
     * @return The number of cTokens returned.
     */
    function toCTokenAmount(uint256 amount) public view returns (uint256) {
        return amount.divDown(_exchangeRate);
    }

    /**
     * @notice Set the exchange rate for testing purposes.
     * @param newExchangeRate The number of underlying tokens per cToken, scaled to 1e18.
     */
    function setExchangeRate(uint256 newExchangeRate) external {
        _exchangeRate = newExchangeRate.mulDown(_scaleFactor);
    }
}
