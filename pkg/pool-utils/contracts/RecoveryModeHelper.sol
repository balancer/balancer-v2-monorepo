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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/BasePoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRecoveryModeHelper.sol";

import "./lib/BasePoolMath.sol";
import "./lib/ComposablePoolLib.sol";

contract RecoveryModeHelper is IRecoveryModeHelper {
    using BasePoolUserData for bytes;

    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function getVault() public view override returns (IVault) {
        return _vault;
    }

    /// @inheritdoc IRecoveryModeHelper
    function calcComposableRecoveryAmountsOut(
        bytes32 poolId,
        bytes memory userData,
        uint256 totalSupply
    ) external view override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        // As this is a composable Pool, `_doRecoveryModeExit()` must use the virtual supply rather than the
        // total supply to correctly distribute Pool assets proportionally.
        // We must also ensure that we do not pay out a proportional fraction of the BPT held in the Vault, otherwise
        // this would allow a user to recursively exit the pool using BPT they received from the previous exit.

        IVault vault = getVault();
        (IERC20[] memory registeredTokens, , ) = vault.getPoolTokens(poolId);

        uint256[] memory cashBalances = new uint256[](registeredTokens.length);
        for (uint256 i = 0; i < registeredTokens.length; ++i) {
            (uint256 cash, , , ) = vault.getPoolTokenInfo(poolId, registeredTokens[i]);
            cashBalances[i] = cash;
        }

        uint256 virtualSupply;
        (virtualSupply, cashBalances) = ComposablePoolLib.dropBptFromBalances(totalSupply, cashBalances);

        bptAmountIn = userData.recoveryModeExit();

        amountsOut = BasePoolMath.computeProportionalAmountsOut(cashBalances, virtualSupply, bptAmountIn);

        // The Vault expects an array of amounts which includes BPT so prepend an empty element to this array.
        amountsOut = ComposablePoolLib.prependZeroElement(amountsOut);
    }
}
