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
pragma experimental ABIEncoderV2;

import "../solidity-utils/openzeppelin/IERC20.sol";
import "../vault/IBasePool.sol";

interface ILinearPool is IBasePool {
    /**
     * @dev Returns the Pool's main token.
     */
    function getMainToken() external view returns (IERC20);

    /**
     * @dev Returns the Pool's wrapped token.
     */
    function getWrappedToken() external view returns (IERC20);

    /**
     * @dev Returns the index of the Pool's BPT in the Pool tokens array (as returned by IVault.getPoolTokens).
     */
    function getBptIndex() external view returns (uint256);

    /**
     * @dev Returns the index of the Pool's main token in the Pool tokens array (as returned by IVault.getPoolTokens).
     */
    function getMainIndex() external view returns (uint256);

    /**
     * @dev Returns the index of the Pool's wrapped token in the Pool tokens array (as returned by
     * IVault.getPoolTokens).
     */
    function getWrappedIndex() external view returns (uint256);

    /**
     * @dev Returns the Pool's targets for the main token balance. These values have had the main token's scaling
     * factor applied to them.
     */
    function getTargets() external view returns (uint256 lowerTarget, uint256 upperTarget);
}
