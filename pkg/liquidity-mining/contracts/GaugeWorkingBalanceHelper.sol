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
 * veBAL "voting power" of the user with respect to the total "voting power" supply. This value generally decays over
 * time, but will increase with additional veBAL locking.
 *
 * Also computes the working balance ratios: balance/supply, which is more informative when deciding whether
 * it would be advantageous for the user to checkpoint a gauge.
 */
contract GaugeWorkingBalanceHelper {
    using FixedPoint for uint256;

    // 40% (minimum balance, with no veBAL)
    uint256 private constant _TOKENLESS_PRODUCTION = 40e16;

    IVeDelegationProxy private immutable _veDelegationProxy;
    IERC20 private immutable _veBAL;

    // The veBAL user balance always comes from the proxy (on L1 and L2), but versions deployed to some
    // networks require the total supply of veBAL to come from the VotingEscrow instead.
    bool private immutable _readTotalSupplyFromVE;

    constructor(IVeDelegationProxy veDelegationProxy, bool readTotalSupplyFromVE) {
        _veDelegationProxy = veDelegationProxy;
        _veBAL = veDelegationProxy.getVotingEscrow();

        _readTotalSupplyFromVE = readTotalSupplyFromVE;
    }

    /**
     * @dev Returns the VotingEscrowDelegationProxy (as an IVeDelegation, which is exported).
     */
    function getVotingEscrowDelegationProxy() external view returns (IVeDelegation) {
        return _veDelegationProxy;
    }

    /**
     * @dev Returns the VotingEscrow contract associated with the proxy.
     */
    function getVotingEscrow() external view returns (IERC20) {
        return _veBAL;
    }

    /**
     * @dev Returns whether the total supply will be read from the VotingEscrow contract. If false,
     * it will be read from the delegation proxy instead.
     */
    function readsTotalSupplyFromVE() external view returns (bool) {
        return _readTotalSupplyFromVE;
    }

    /**
     * @dev The gauge allocates 60% of the emissions it receives to veBAL holders, which it accomplishes by computing
     * an effective "working" balance for each user, starting with 40% of the true balance (i.e., BPT deposited in
     * the gauge), and adding a "boost" proportional to that user's share of the total voting power.
     *
     * @param gauge - address of a gauge (L1 or L2).
     * @param user - address of a user.
     * @return current and projected balances.
     */
    function getWorkingBalances(IGauge gauge, address user) public view returns (uint256, uint256) {
        uint256 gaugeUserBalance = gauge.balanceOf(user);
        uint256 projectedWorkingBalance = gaugeUserBalance.mulDown(_TOKENLESS_PRODUCTION);
        IVeDelegationProxy proxy = _veDelegationProxy;

        uint256 veTotalSupply = _readTotalSupplyFromVE ? _veBAL.totalSupply() : proxy.totalSupply();

        if (veTotalSupply > 0) {
            uint256 veUserBalance = proxy.adjusted_balance_of(user);
            uint256 gaugeTotalSupply = gauge.totalSupply();

            projectedWorkingBalance = projectedWorkingBalance.add(
                gaugeTotalSupply.mulDown(veUserBalance).mulDown(_TOKENLESS_PRODUCTION.complement()).divDown(
                    veTotalSupply
                )
            );

            projectedWorkingBalance = Math.min(gaugeUserBalance, projectedWorkingBalance);
        }

        return (gauge.working_balances(user), projectedWorkingBalance);
    }

    /**
     * @dev There is also a "working" supply, needed to ensure that all the emissions are allocated.
     * Compute and return the balance/supply ratios. This captures the behavior of other users, and more
     * accurately reflects this user's relative position.
     *
     * @param gauge - address of a gauge (L1 or L2).
     * @param user - address of a user.
     * @return ratio of the current `working_balance` of the user to the current `working_supply` of the gauge.
     * @return ratio of the projected `working_balance` of the user (after `user_checkpoint`),
     *         to the projected `working_supply` of the gauge.
     */
    function getWorkingBalanceToSupplyRatios(IGauge gauge, address user) external view returns (uint256, uint256) {
        (uint256 currentWorkingBalance, uint256 projectedWorkingBalance) = getWorkingBalances(gauge, user);
        uint256 currentWorkingSupply = gauge.working_supply();

        uint256 projectedWorkingSupply = currentWorkingSupply.add(projectedWorkingBalance).sub(currentWorkingBalance);

        return (
            currentWorkingBalance.divDown(currentWorkingSupply),
            projectedWorkingBalance.divDown(projectedWorkingSupply)
        );
    }
}
