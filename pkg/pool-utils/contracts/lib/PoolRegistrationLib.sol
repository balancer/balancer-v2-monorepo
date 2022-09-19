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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";

library PoolRegistrationLib {
    function registerPool(
        IVault vault,
        IVault.PoolSpecialization specialization,
        IERC20[] memory tokens
    ) internal returns (bytes32) {
        return registerPoolWithAssetManagers(vault, specialization, tokens, new address[](tokens.length));
    }

    function registerPoolWithAssetManagers(
        IVault vault,
        IVault.PoolSpecialization specialization,
        IERC20[] memory tokens,
        address[] memory assetManagers
    ) internal returns (bytes32) {
        // The Vault only requires the token list to be ordered for the Two Token Pools specialization. However,
        // to make the developer experience consistent, we are requiring this condition for all the native pools.
        //
        // Note that for Pools which can register and deregister tokens after deployment, this property may not hold
        // as tokens which are added to the Pool after deployment are always added to the end of the array.
        InputHelpers.ensureArrayIsSorted(tokens);

        bytes32 poolId = vault.registerPool(specialization);

        // We don't need to check that tokens and assetManagers have the same length, since the Vault already performs
        // that check.
        vault.registerTokens(poolId, tokens, assetManagers);

        return poolId;
    }

    function registerToken(
        IVault vault,
        bytes32 poolId,
        IERC20 token,
        address assetManager
    ) internal {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = token;

        address[] memory assetManagers = new address[](1);
        assetManagers[0] = assetManager;

        vault.registerTokens(poolId, tokens, assetManagers);
    }

    function deregisterToken(
        IVault vault,
        bytes32 poolId,
        IERC20 token
    ) internal {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = token;

        vault.deregisterTokens(poolId, tokens);
    }
}
