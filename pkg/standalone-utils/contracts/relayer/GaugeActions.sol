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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerMinter.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakingLiquidityGauge.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title GaugeActions
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract GaugeActions is IBaseRelayerLibrary {
    using SafeERC20 for IERC20;

    IBalancerMinter private immutable _balancerMinter;

    /**
     * @dev The zero address may be passed as balancerMinter to safely disable features
     *      which only exist on mainnet
     */
    constructor(IBalancerMinter balancerMinter) {
        _balancerMinter = balancerMinter;
    }

    function gaugeDeposit(
        IStakingLiquidityGauge gauge,
        address sender,
        address recipient,
        uint256 amount
    ) external payable {
        // We can query which token to pull and approve from the wrapper contract.
        IERC20 bptToken = gauge.lp_token();

        amount = _resolveAmountPullTokenAndApproveSpender(bptToken, address(gauge), amount, sender);

        gauge.deposit(amount, recipient);
    }

    function gaugeWithdraw(
        IStakingLiquidityGauge gauge,
        address sender,
        address recipient,
        uint256 amount
    ) external payable {
        amount = _resolveAmountAndPullToken(gauge, amount, sender);

        // No approval is needed here, as the gauge Tokens are burned directly from the relayer's account.
        gauge.withdraw(amount);

        // Gauge does not support withdrawing BPT to another address atomically.
        // If intended recipient is not the relayer then forward the withdrawn BPT on to the recipient.
        if (recipient != address(this)) {
            IERC20 bptToken = gauge.lp_token();

            bptToken.safeTransfer(recipient, amount);
        }
    }

    function gaugeMint(address[] calldata gauges, uint256 outputReference) external payable {
        uint256 balMinted = _balancerMinter.mintManyFor(gauges, msg.sender);

        _setChainedReference(outputReference, balMinted);
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

    function gaugeClaimRewards(IStakingLiquidityGauge[] calldata gauges) external payable {
        uint256 numGauges = gauges.length;
        for (uint256 i; i < numGauges; ++i) {
            gauges[i].claim_rewards(msg.sender);
        }
    }
}
