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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

library VaultReentrancyLib {
    /**
     * @dev Ensure we are not in a Vault context when this function is called, by attempting a no-op internal
     * balance operation. If we are already in a Vault transaction (e.g., a swap, join, or exit), the Vault's
     * reentrancy protection will cause this function to revert.
     *
     * The exact function call doesn't really matter: we're just trying to trigger the Vault reentrancy check
     * (and not hurt anything in case it works). An empty operation array with no specific operation at all works
     * for that purpose, and is also the least expensive in terms of gas and bytecode size.
     *
     * Call this at the top of any function that can cause a state change in a pool and is either public itself,
     * or called by a public function *outside* a Vault operation (e.g., join, exit, or swap).
     *
     * If this is *not* called in functions that are vulnerable to the read-only reentrancy issue described
     * here (https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345), those functions are unsafe,
     * and subject to manipulation that may result in loss of funds.
     */
    function ensureNotInVaultContext(IVault vault) internal view {
        // Perform the following operation to trigger the Vault's reentrancy guard.
        // Use a static call so that it can be a view function (even though the
        // function is non-view).
        //
        // IVault.UserBalanceOp[] memory noop = new IVault.UserBalanceOp[](0);
        // _vault.manageUserBalance(noop);

        // Read-only re-entrancy protection.
        // This call always reverts, but we need to make sure it doesn't fail due to a re-entrancy attack.
        // Staticcall consumes all gas forwarded to it on a revert. By default,
        // almost the entire gas is forwarded to the staticcall,
        // causing the entire call to revert with an 'out of gas' error.
        // We set the gas limit to 100k, but the exact number doesn't matter because
        // view calls are free, and non-view calls won't waste
        // the entire gas limit on a revert.
        // Revert happens inside the _enterNonReentrant function.
        //
        //    function _enterNonReentrant() private {
        //        // Will revert here in case of reentrancy
        //        // Results to revertData abi.encodeWithSignature("Error(string)", "BAL#400")
        //        _require(_status != _ENTERED, Errors.REENTRANCY);
        //
        //        // Will revert here because modifies storage
        //        // Results to empty revertData
        //        _status = _ENTERED;
        //    }
        //
        // Based on the code in the enterNonReentrant function, there are two
        // possible revertData values: 0x and abi.encodeWithSignature("Error(string)", "BAL#400").
        // It is more bytecode and gas efficient to check that revertData is
        // zero than to compare it to the REENTRANCY revertData. This also prevents
        // other non-zero errors from passing the check.
        (, bytes memory revertData) = address(vault).staticcall{ gas: 100_000 }(
            abi.encodeWithSelector(vault.manageUserBalance.selector, 0)
        );

        _require(revertData.length == 0, Errors.REENTRANCY);
    }
}
