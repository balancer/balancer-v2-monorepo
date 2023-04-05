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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IVaultReentrancyLib.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

contract VaultReentrancyLib is IVaultReentrancyLib {
    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    /// @inheritdoc IVaultReentrancyLib
    function ensureNotInVaultContext() external view override {
        //IVault.UserBalanceOp[] memory noop = new IVault.UserBalanceOp[](0);
        //_vault.manageUserBalance(noop);
        bytes32 REENTRANCY_ERROR_HASH = keccak256(abi.encodeWithSignature("Error(string)", "BAL#400"));

        // read-only re-entrancy protection - this call is always unsuccessful but we need to make sure
        // it didn't fail due to a re-entrancy attack
        (, bytes memory revertData) = address(_vault).staticcall(
            abi.encodeWithSelector(_vault.manageUserBalance.selector, new address[](0))
        );

        _require(keccak256(revertData) != REENTRANCY_ERROR_HASH, Errors.REENTRANCY);
    }
}
