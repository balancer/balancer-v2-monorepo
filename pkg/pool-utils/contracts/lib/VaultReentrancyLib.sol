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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

library VaultReentrancyLib {
    /**
     * @dev Ensure we are not in a Vault context when this function is called, by attempting a zero-value internal
     * balance operation. If we are already in a Vault transaction (e.g., a swap, join, or exit), the Vault's
     * reentrancy protection will cause this function to revert.
     *
     * The exact function call doesn't really matter: we're just trying to trigger the Vault reentrancy check
     * (and not hurt anything in case it works). WITHDRAW_INTERNAL has the shortest code path, so should use
     * the least gas.
     *
     * Call this at the top of any function that can cause a state change in a pool and is either public itself,
     * or called by a public function *outside* a Vault operation (e.g., join, exit, or swap).
     */
    function ensureNotInVaultContext(IVault vault) internal {
        IVault.UserBalanceOp[] memory noop = new IVault.UserBalanceOp[](1);
        noop[0] = IVault.UserBalanceOp({
            kind: IVault.UserBalanceOpKind.WITHDRAW_INTERNAL,
            asset: IAsset(address(0)),
            amount: 0,
            sender: address(this),
            recipient: payable(address(this))
        });

        vault.manageUserBalance(noop);
    }
}
