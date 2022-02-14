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

import "@balancer-labs/v2-gauges/contracts/interfaces/IBalancerMinter.sol";
import "@balancer-labs/v2-gauges/contracts/interfaces/ILiquidityGauge.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "../interfaces/IBaseRelayerLibrary.sol";
import "../interfaces/IStaticATokenLM.sol";

/**
 * @title GaugeActions
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract GaugeActions is IBaseRelayerLibrary {
    using Address for address payable;

    IBalancerMinter private immutable _balancerMinter;

    /**
     * @dev The zero address may be passed as balancerMinter to safely disable features
     *      which only exist on mainnet
     */
    constructor(IBalancerMinter balancerMinter) {
        _balancerMinter = balancerMinter;
    }

    function gaugeDeposit(
        ILiquidityGauge gauge,
        address sender,
        address recipient,
        uint256 amount
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        // We can query which token to pull and approve from the wrapper contract.
        IERC20 bptToken = gauge.lp_token();

        // The deposit caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, bptToken, amount);
        }

        bptToken.approve(address(gauge), amount);
        gauge.deposit(amount, recipient);
    }

    function gaugeWithdraw(
        ILiquidityGauge gauge,
        address sender,
        address recipient,
        uint256 amount
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        // The unwrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, gauge, amount);
        }

        // No approval is needed here, as the gauge Tokens are burned directly from the relayer's account.
        gauge.withdraw(amount);

        // Gauge does not support withdrawing BPT to another address atomically.
        // If intended recipient is not the relayer then forward the withdrawn BPT on to the recipient.
        if (recipient != address(this)) {
            IERC20 bptToken = gauge.lp_token();

            bptToken.transfer(recipient, amount);
        }
    }

    function gaugeMint(address[] calldata gauges, uint256 outputReference) external payable {
        uint256 balMinted = _balancerMinter.mintManyFor(gauges, msg.sender);

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, balMinted);
        }
    }

    function gaugeSetMinterApproval(
        bool approval,
        address user,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable {
        _balancerMinter.setMinterApprovalWithSignature(address(this), approval, user, deadline, v, r, s);
    }

    function gaugeClaimRewards(ILiquidityGauge[] calldata gauges) external payable {
        uint256 numGauges = gauges.length;
        for (uint256 i; i < numGauges; ++i) {
            gauges[i].claim_rewards(msg.sender);
        }
    }
}
