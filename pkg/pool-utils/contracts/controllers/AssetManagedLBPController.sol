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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "../interfaces/IControlledLiquidityBootstrappingPool.sol";
import "./BasePoolController.sol";

/**
 * @notice Controller for an unseeded LiquidityBootstrappingPool. It also serves as the asset manager.
 * Using the `UnseededLiquidityBootstrappingPoolFactory` will deploy this controller and a pool.
 * After the contracts are deployed by the factory, the manager can call `fundPool` on the controller
 * with the initial balances. This funds the pool using the manager's pool tokens. The reserve tokens
 * will be supplied using an AAVE flashloan, then immediately withdrawn using the asset manager
 * functionality to repay the loan.
 *
 * The result is an apparently fully funded pool, but with a zero cash balance in the reserve token.
 * This means project tokens cannot be "sold back" into the pool - at least until enough are sold to
 * build up the real balance.
 *
 * Note that there is a flash loan fee, so the manager will need enough reserve tokens to pay it (and
 * must approve the controller to pull them during the `fundPool` call). The amount of the fee can be
 * calculated using the `getFlashLoanFeePercentage` function on the controller.
 *
 * The controller can then be used by the manager for regular LBP functions.
 */
contract AssetManagedLBPController is BasePoolController, IControlledLiquidityBootstrappingPool {
    using FixedPoint for uint256;

    // WeightedPoolUserData type - duplicating here to avoid a circular dependency
    enum JoinKind { INIT }

    IVault private immutable _vault;
    IERC20 private immutable _reserveToken;
    uint256 private immutable _projectTokenIndex;
    uint256 private immutable _reserveTokenIndex;
    uint256 private _virtualReserveAmount;

    constructor(
        BasePoolRights memory baseRights,
        IVault vault,
        IERC20 reserveToken,
        bool projectTokenFirst,
        address manager
    ) BasePoolController(encodePermissions(baseRights), manager) {
        _reserveToken = reserveToken;
        _projectTokenIndex = projectTokenFirst ? 0 : 1;
        _reserveTokenIndex = projectTokenFirst ? 1 : 0;
        _vault = vault;
    }

    /**
     * @dev Call this function instead of the usual `joinPool` (init). It will borrow the necessary amount
     * of reserve tokens using a DODO flashloan.
     */
    function fundPool(uint256[] memory initialBalances) external onlyManager {
        uint256 virtualAmount = initialBalances[_getReserveTokenIndex()];
        _virtualReserveAmount = virtualAmount;

        // Set the total to the virtual balance we need
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, getPoolId(), _reserveToken, virtualAmount);
        _vault.managePoolBalance(ops);

        // Pull project tokens from the manager
        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(getPoolId());

        tokens[_getProjectTokenIndex()].transferFrom(
            getManager(),
            address(this),
            initialBalances[_getProjectTokenIndex()]
        );

        // We are apparently joining with all tokens (initialBalances includes the reserve token)
        // This is necessary for the invariant calculations and initial BPT minting
        // `_onInitialize` in the pool checks if there is a managed balance: if there is, it passes
        // zero to the Vault in amountsIn for the reserve token.

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: initialBalances,
            userData: abi.encode(JoinKind.INIT, initialBalances),
            fromInternalBalance: false
        });

        tokens[_getProjectTokenIndex()].approve(address(_vault), initialBalances[_getProjectTokenIndex()]);

        // Fund the pool; pull the tokens from this contract, send BPT to the manager
        _vault.joinPool(getPoolId(), address(this), getManager(), request);
    }

    /**
     * @dev The initial funding results in a non-zero managed balance. When the cash balance is greater,
     * this function can be called to return the managed funds to cash.
     * If there is a managed balance, and the cash balance is greater, convert the managed balance to cash.
     */
    function restorePool() external {
        (uint256 cash, uint256 managed, , ) = _vault.getPoolTokenInfo(getPoolId(), _reserveToken);

        if (managed > 0 && cash >= _getVirtualReserveAmount()) {
            IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
            ops[0] = IVault.PoolBalanceOp(
                IVault.PoolBalanceOpKind.DEPOSIT,
                getPoolId(),
                _reserveToken,
                _getVirtualReserveAmount()
            );

            _vault.managePoolBalance(ops);
        }
    }

    function _getVirtualReserveAmount() private view returns (uint256) {
        return _virtualReserveAmount;
    }

    function _getProjectTokenIndex() private view returns (uint256) {
        return _projectTokenIndex;
    }

    function _getReserveTokenIndex() private view returns (uint256) {
        return _reserveTokenIndex;
    }

    // LBP functions

    function setSwapEnabled(bool swapEnabled) external override onlyManager withBoundPool {
        IControlledLiquidityBootstrappingPool(pool).setSwapEnabled(swapEnabled);
    }

    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external override onlyManager withBoundPool {
        IControlledLiquidityBootstrappingPool(pool).updateWeightsGradually(startTime, endTime, endWeights);
    }

    function _getReserveToken() private view returns (IERC20) {
        return _reserveToken;
    }
}
