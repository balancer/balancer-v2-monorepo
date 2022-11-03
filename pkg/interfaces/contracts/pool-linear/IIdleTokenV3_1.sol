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

// Based on https://github.com/Idle-Labs/idle-contracts/blob/develop/contracts/IdleTokenV3_1.sol

pragma solidity >=0.7.0 <0.9.0;

import "../solidity-utils/openzeppelin/IERC20.sol";

interface IIdleTokenV3_1 is IERC20 {
    /**
     * @dev returns the address of the underlying asset
     * https://docs.idle.finance/developers/best-yield/interface
     */
    function token() external view returns (address);

    /**
     * @dev returns the current $IDLE token price, in underlying (e.g. DAI) terms.
     * I.e., tokenPrice() is scaled according to mainToken decimals
     * https://docs.idle.finance/developers/best-yield/methods/tokenprice
     */
    function tokenPrice() external view returns (uint256);

    /**
     * @dev used to deposit money into the Idle protocol
     * https://docs.idle.finance/developers/best-yield/methods/mintidletoken
     */
    function mintIdleToken(
        uint256 _amount,
        bool _skipWholeRebalance, 
        address _referral
    ) external returns (uint256 mintedTokens);

    /**
     * @dev redeem underlying balance by burning $IDLE tokens
     * https://docs.idle.finance/developers/best-yield/methods/redeemidletoken-1
     */
    function redeemIdleToken(
        uint256 _amountIdleTokens
    ) external returns (uint256 redeemedTokens);

    /**
     * @dev Total amount of the underlying asset that is “managed” by Vault.
     * IMPORTANT: NOT IMPLEMENTED BY THE ORIGINAL TOKEN. THIS FUNCTION IS FOR TESTING PURPOSES ONLY
     */
    function totalAssets() external view returns (uint256);
}