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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerTokenAdmin.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGauge.sol";

import "../BaseCoordinator.sol";

contract TribeBALMinterCoordinator is BaseCoordinator {
    address public constant TRIBE_VEBAL_PCV_DEPOSIT = 0xc4EAc760C2C631eE0b064E39888b89158ff808B2;
    // Address taken from https://forum.balancer.fi/t/tribe-dao-unclaimable-bal-rewards/3196/5
    address public constant TRIBE_BAL_RECIPIENT = 0xc5bb8F0253776beC6FF450c2B40f092f7e7f5b57;

    // Can be checked by calling `integrate_fraction(TRIBE_VEBAL_PCV_DEPOSIT)` on `FEI_WETH_LIQUIDITY_GAUGE`.
    // As a double check, simulating minting BAL through performing a `mint` call to the `BalancerMinter` from
    // `TRIBE_VEBAL_PCV_DEPOSIT` results in the same amount of BAL being minted.
    uint256 public constant TRIBE_BAL_MINT_AMOUNT = 34343783425791862574551;

    IBalancerTokenAdmin public constant BALANCER_TOKEN_ADMIN = IBalancerTokenAdmin(
        0xf302f9F50958c5593770FDf4d4812309fF77414f
    );
    ILiquidityGauge public constant FEI_WETH_LIQUIDITY_GAUGE = ILiquidityGauge(
        0x4f9463405F5bC7b4C1304222c1dF76EFbD81a407
    );

    constructor(IAuthorizerAdaptor authorizerAdaptor) BaseCoordinator(authorizerAdaptor) {
        // We want to check that we're not more minting BAL than Tribe is due so read the amount that the gauge reports.
        // We allow the inequality as someone may deposit LP tokens on Tribe's behalf and checkpoint the gauge.
        require(
            FEI_WETH_LIQUIDITY_GAUGE.integrate_fraction(TRIBE_VEBAL_PCV_DEPOSIT) >= TRIBE_BAL_MINT_AMOUNT,
            "Mint amount does not match gauge state"
        );
    }

    // Coordinator Setup

    function _registerStages() internal override {
        _registerStage(_mintBALForTribe);
    }

    function _afterLastStage() internal virtual override {
        ICurrentAuthorizer authorizer = ICurrentAuthorizer(address(getAuthorizer()));
        bytes32 mintBALRole = BALANCER_TOKEN_ADMIN.getActionId(IBalancerTokenAdmin.mint.selector);

        authorizer.renounceRole(mintBALRole, address(this));
    }

    // Internal functions

    function _mintBALForTribe() private {
        BALANCER_TOKEN_ADMIN.mint(TRIBE_BAL_RECIPIENT, TRIBE_BAL_MINT_AMOUNT);
    }
}
