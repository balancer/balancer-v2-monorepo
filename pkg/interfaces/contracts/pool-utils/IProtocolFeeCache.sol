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

interface IProtocolFeeCache {
    /**
     * @notice Updates the cache to the latest value set by governance.
     * @dev Can be called by anyone to update the cached fee percentages.
     *
     * Correct behavior depends on the token balances from the Vault, which may be out of sync with the state of
     * the pool during execution of a Vault hook. This is protected by a call to `ensureNotInVaultContext` in
     * VaultReentrancyLib where overridden in `ProtocolFeeCache`, and so is safe to call on ManagedPool.
     *
     * See https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345 for reference.
     */
    function updateProtocolFeePercentageCache() external;
}
