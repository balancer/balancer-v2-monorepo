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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";

import "../interfaces/IVault.sol";

contract MockInternalBalanceRelayer {
    IVault public vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    function depositAndWithdraw(
        address payable sender,
        IAsset asset,
        uint256[] memory depositAmounts,
        uint256[] memory withdrawAmounts
    ) public {
        InputHelpers.ensureInputLengthMatch(depositAmounts.length, withdrawAmounts.length);
        for (uint256 i = 0; i < depositAmounts.length; i++) {
            IVault.UserBalanceOp[] memory deposit = _buildUserBalanceOp(
                IVault.UserBalanceOpKind.DEPOSIT_INTERNAL,
                sender,
                asset,
                depositAmounts[i]
            );
            vault.manageUserBalance(deposit);

            IVault.UserBalanceOp[] memory withdraw = _buildUserBalanceOp(
                IVault.UserBalanceOpKind.WITHDRAW_INTERNAL,
                sender,
                asset,
                withdrawAmounts[i]
            );
            vault.manageUserBalance(withdraw);
        }
    }

    function _buildUserBalanceOp(
        IVault.UserBalanceOpKind kind,
        address payable sender,
        IAsset asset,
        uint256 amount
    ) internal pure returns (IVault.UserBalanceOp[] memory ops) {
        ops = new IVault.UserBalanceOp[](1);
        ops[0] = IVault.UserBalanceOp({ asset: asset, amount: amount, sender: sender, recipient: sender, kind: kind });
    }
}
