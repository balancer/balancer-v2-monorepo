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

pragma experimental ABIEncoderV2;

import "../RewardsAssetManager.sol";

pragma solidity ^0.7.0;

// solhint-disable no-empty-blocks
// solhint-disable var-name-mixedcase
// solhint-disable private-vars-leading-underscore
contract TestAssetManager is RewardsAssetManager {
    using Math for uint256;
    uint256 public nextAUM;

    constructor(
        IVault _vault,
        bytes32 _poolId,
        IERC20 _token
    ) RewardsAssetManager(_vault, _poolId, _token) {}

    /**
     * @dev Should be called in same transaction as deployment through a factory contract
     */
    function initialise(bytes32 pId) public {
        _initialise(pId);
    }

    /**
     * @param amount - the amount of tokens being deposited
     * @param aum - the current assets under management of this asset manager
     * @return the number of shares to mint for the pool
     */
    function _invest(uint256 amount, uint256 aum) internal override returns (uint256) {
        nextAUM = aum + amount;
        return amount;
    }

    /**
     * @param amount - the amount of tokens being divested
     * @return the number of tokens to return to the vault
     */
    function _divest(uint256 amount, uint256 aum) internal override returns (uint256) {
        nextAUM = aum - amount;
        return amount;
    }

    /**
     * @return the current assets under management of this asset manager
     */
    function readAUM() public view override returns (uint256) {
        return nextAUM;
    }

    /**
     * @dev Sets the next value to be read by `readAUM`
     */
    function setUnrealisedAUM(uint256 aum) external {
        nextAUM = aum;
    }
}
