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


import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

contract MockWithdrawDepositAssetManager {
    using SafeERC20 for IERC20;

    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function withdrawFromPool(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external {
        // Tokens can be withdrawn from the Vault with a 'withdraw' operation, but that will create 'managed' balance
        // and leave the 'total' balance unchanged. We therefore have to perform two operations: one to withdraw, and
        // another to clear the 'managed' balance.
        IVault.PoolBalanceOp[] memory withdrawal = new IVault.PoolBalanceOp[](2);

        // First, we withdraw the tokens, creating a non-zero 'managed' balance in the Pool.
        withdrawal[0].kind = IVault.PoolBalanceOpKind.WITHDRAW;
        withdrawal[0].poolId = poolId;
        withdrawal[0].amount = amount;
        withdrawal[0].token = token;

        // Then, we clear the 'managed' balance.
        withdrawal[1].kind = IVault.PoolBalanceOpKind.UPDATE;
        withdrawal[1].poolId = poolId;
        withdrawal[1].amount = 0;
        withdrawal[1].token = token;

        _vault.managePoolBalance(withdrawal);
    }

    function depositToPool(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external {
        // Tokens can be deposited to the Vault with a 'deposit' operation, but that requires a prior 'managed'
        // balance to exist. We therefore have to perform two operations: one to set the 'managed' balance (representing
        // the new tokens which we are managing for the Pool), and another to deposit.
        IVault.PoolBalanceOp[] memory deposit = new IVault.PoolBalanceOp[](2);

        // First, we inform the Vault of the 'managed' tokens.
        deposit[0].kind = IVault.PoolBalanceOpKind.UPDATE;
        deposit[0].poolId = poolId;
        deposit[0].amount = amount;
        deposit[0].token = token;

        // Then, we deposit them, clearing the 'managed' balance.
        deposit[1].kind = IVault.PoolBalanceOpKind.DEPOSIT;
        deposit[1].poolId = poolId;
        deposit[1].amount = amount;
        deposit[1].token = token;

        // Before we can deposit tokens into the Vault however, we must approve them.
        token.safeApprove(address(_vault), amount);
        _vault.managePoolBalance(deposit);
    }
}
