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

pragma solidity >=0.7.0 <0.9.0;
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

    /**
     * @notice Set the lower and upper bounds of the zero-fee trading range for the main token balance.
     * @dev For a new target range to be valid:
     *      - the current balance must be between the current targets (meaning no fees are currently pending)
     *      - the current balance must be between the new targets (meaning setting them does not create pending fees)
     *
     * The first requirement could be relaxed, as the LPs actually benefit from the pending fees not being paid out,
     * but being stricter makes analysis easier at little expense.
     *
     * This is a permissioned function, reserved for the pool owner. It will revert when called within a Vault context
     * (i.e. in the middle of a join or an exit).
     *
     * Correct behavior depends on the token balances from the Vault, which may be out of sync with the state of
     * the pool during execution of a Vault hook.
     *
     * See https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345 for reference.
     */
    function setTargets(uint256 newLowerTarget, uint256 newUpperTarget) external;

    /**
     * @notice Set the swap fee percentage.
     * @dev This is a permissioned function, reserved for the pool owner. It will revert when called within a Vault
     * context (i.e. in the middle of a join or an exit).
     *
     * Correct behavior depends on the token balances from the Vault, which may be out of sync with the state of
     * the pool during execution of a Vault hook.
     *
     * See https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345 for reference.
     */
    function setSwapFeePercentage(uint256 swapFeePercentage) external;
}
