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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

contract RelayerAssetHelpers {
    using Address for address payable;

    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    receive() external payable {
        // Accept ETH transfers coming from the Vault only. This is only expected to happen when joining a pool,
        // performing a swap or managing a user's balance does not use the full amount of ETH provided.
        // Any remaining ETH value will be transferred back to this contract and forwarded back to the original sender.
        _require(msg.sender == address(_vault), Errors.ETH_TRANSFER);
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function _approveToken(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        if (token.allowance(address(this), spender) < amount) {
            token.approve(spender, type(uint256).max);
        }
    }

    function _sweepETH() internal {
        uint256 remainingEth = address(this).balance;
        if (remainingEth > 0) {
            msg.sender.sendValue(remainingEth);
        }
    }

    function _pullToken(
        address sender,
        IERC20 token,
        uint256 amount
    ) internal {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = token;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        _pullTokens(sender, tokens, amounts);
    }

    function _pullTokens(
        address sender,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) internal {
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            ops[i] = IVault.UserBalanceOp({
                asset: IAsset(address(tokens[i])),
                amount: amounts[i],
                sender: sender,
                recipient: payable(address(this)),
                kind: IVault.UserBalanceOpKind.TRANSFER_EXTERNAL
            });
        }

        getVault().manageUserBalance(ops);
    }
}
