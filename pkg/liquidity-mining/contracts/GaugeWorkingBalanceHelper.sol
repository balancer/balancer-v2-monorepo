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
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IVeDelegation.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

// There is already an IVeDelegation with the first two
interface IVeDelegationProxy is IVeDelegation {
    function getVotingEscrow() external view returns (IERC20);
}

interface IGauge {
    function balanceOf(address user) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    // solhint-disable func-name-mixedcase
    function working_balances(address user) external view returns (uint256);

    function working_supply() external view returns (uint256);
    // solhint-enable func-name-mixedcase
}

/**
 * @notice Get the current and projected `working_balance` (effective veBAL boosted balance) for a user on a gauge.
 * @dev The `working_balance` can range between 40% and 100% of the nominal user balance on a gauge, depending on the
 * veBAL "voting power" of the user. This value generally decays over time, but will increase with additional veBAL
 * locking.
 */
contract GaugeWorkingBalanceHelper {
    using FixedPoint for uint256;

    uint256 private constant _TOKENLESS_PRODUCTION = 40e16; // 40% (minimum balance, with no veBAL)

    IVeDelegationProxy private immutable _veDelegationProxy;
    IERC20 private immutable _veBAL;
    bool public immutable readTotalSupplyFromVE;

    constructor(IVeDelegationProxy veDelegationProxy, bool _readTotalSupplyFromVE) {
        _veDelegationProxy = veDelegationProxy;
        _veBAL = veDelegationProxy.getVotingEscrow();
        readTotalSupplyFromVE = _readTotalSupplyFromVE;
    }

    /**
     * @dev Returns the VotingEscrowDelegationProxy.
     */
    function getVotingEscrowDelegationProxy() external view returns (address) {
        return address(_veDelegationProxy);
    }

    /**
     * @dev Returns the VotingEscrow contract associated with the proxy.
     */
    function getVotingEscrow() external view returns (address) {
        return address(_veBAL);
    }

    /**
     *
     * @param gauge - address of a gauge (L1 or L2).
     * @param user - address of a user.
     * @return ratio of the current `working_balance` of the user to the current `working_supply` of the gauge.
     * @return ratio of the projected `working_balance` of the user (after `user_checkpoint`),
     *         to the projected `working_supply` of the gauge.
     */
    function getWorkingBalances(IGauge gauge, address user) external view returns (uint256, uint256) {
        uint256 gaugeUserBalance = gauge.balanceOf(user);
        uint256 projectedWorkingBalance = gaugeUserBalance.mulDown(_TOKENLESS_PRODUCTION);
        uint256 veTotalSupply = readTotalSupplyFromVE ? _veBAL.totalSupply() : _veDelegationProxy.totalSupply();

        if (veTotalSupply > 0) {
            uint256 veUserBalance = _veDelegationProxy.adjusted_balance_of(user);
            uint256 gaugeTotalSupply = gauge.totalSupply();

            projectedWorkingBalance = projectedWorkingBalance.add(
                gaugeTotalSupply.mulDown(veUserBalance).mulDown(_TOKENLESS_PRODUCTION.complement()).divDown(
                    veTotalSupply
                )
            );

            projectedWorkingBalance = Math.min(gaugeUserBalance, projectedWorkingBalance);
        }

        uint256 currentWorkingBalance = gauge.working_balances(user);
        uint256 currentWorkingSupply = gauge.working_supply();
        uint256 projectedWorkingSupply = currentWorkingSupply.add(projectedWorkingBalance.sub(currentWorkingBalance));

        return (
            currentWorkingBalance.divDown(currentWorkingSupply),
            projectedWorkingBalance.divDown(projectedWorkingSupply)
        );
    }
}
