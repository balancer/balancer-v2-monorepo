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

import "@balancer-labs/v2-asset-manager-utils/contracts/aave/IFlashLoanSimpleReceiver.sol";
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
contract AaveAssetManagedLBPController is
    BasePoolController,
    IControlledLiquidityBootstrappingPool,
    IFlashLoanSimpleReceiver
{
    using FixedPoint for uint256;

    // WeightedPoolUserData type - duplicating here to avoid a circular dependency
    enum JoinKind { INIT }

    IPoolAddressesProvider private immutable _addressesProvider;
    IPool private immutable _lendingPool;
    uint256 private immutable _flashLoanFeePercentage;
    IERC20 private immutable _reserveToken;
    IVault private immutable _vault;
    bool private immutable _projectTokenFirst;

    constructor(
        BasePoolRights memory baseRights,
        IPoolAddressesProvider addressesProvider,
        IVault vault,
        IERC20 reserveToken,
        bool projectTokenFirst,
        address manager
    ) BasePoolController(encodePermissions(baseRights), manager) {
        IPool pool = IPool(addressesProvider.getPool());

        _addressesProvider = addressesProvider;
        _lendingPool = pool;
        _flashLoanFeePercentage = uint256(pool.FLASHLOAN_PREMIUM_TOTAL()).divUp(10000);
        _reserveToken = reserveToken;
        _projectTokenFirst = projectTokenFirst;
        _vault = vault;
    }

    /**
     * @dev Getter for the flash loan fee percentage (adjusted from basis points)
     */
    function getFlashLoanFeePercentage() external view returns (uint256) {
        return _flashLoanFeePercentage;
    }

    /**
     * @dev Call this function instead of the usual `joinPool` (init). It will borrow the necessary amount
     * of reserve tokens using an AAVE flashloan.
     */
    function fundPool(uint256[] memory initialBalances) external onlyManager {
        // ensure the manager has enough balance for the fee
        uint256 flashLoanFeeAmount = initialBalances[1].mulUp(_flashLoanFeePercentage);
        _require(
            _reserveToken.balanceOf(getManager()) >= flashLoanFeeAmount,
            Errors.INSUFFICIENT_FLASH_LOAN_FEE_AMOUNT
        );

        // Borrow the funds

        _reserveToken.approve(address(_lendingPool), type(uint256).max);

        _lendingPool.flashLoanSimple(
            address(this), // hold funds in the controller (= pool owner)
            address(_reserveToken),
            initialBalances[_projectTokenFirst ? 1 : 0], // reserve token balance
            abi.encode(initialBalances), // pass initial balances as parameters
            0 // do we have a referral code?
        );
    }

    /**
     * @dev This function is called by AAVE when the loan funds are available.
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Can only be called by this contract
        _require(initiator == address(this), Errors.SENDER_NOT_ALLOWED);

        // Transfer the flashloan fee from the manager
        IERC20(asset).transferFrom(getManager(), address(this), premium);

        // At this point, we have the loan funds plus the fee, and are ready to fund the pool
        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(getPoolId());

        uint256[] memory initialBalances = abi.decode(params, (uint256[]));

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: initialBalances,
            userData: abi.encode(JoinKind.INIT, initialBalances),
            fromInternalBalance: false
        });

        // Pull project tokens from the manager
        uint256 projectTokenIndex = _projectTokenFirst ? 0 : 1;

        tokens[projectTokenIndex].transferFrom(getManager(), address(this), initialBalances[projectTokenIndex]);

        tokens[0].approve(address(_vault), initialBalances[0]);
        tokens[1].approve(address(_vault), initialBalances[1]);

        // Fund the pool; pull the tokens from this contract, send BPT to the manager
        _vault.joinPool(getPoolId(), address(this), getManager(), request);

        // Withdraw the borrowed seed funds (this contract is also the asset manager)
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, getPoolId(), IERC20(asset), amount);
        _vault.managePoolBalance(ops);

        // Returning from this will cause AAVE to pull the amount + fee from this contract
        IERC20(asset).approve(address(_lendingPool), amount.add(premium));

        return true;
    }

    /**
     * @dev The initial funding results in a non-zero managed balance. When the cash balance is greater,
     * this function can be called to return the managed funds to cash.
     * If there is a managed balance, and the cash balance is greater, convert the managed balance to cash.
     */
    function restorePool() external {
        (uint256 cash, uint256 managed, , ) = _vault.getPoolTokenInfo(getPoolId(), _reserveToken);

        if (managed > 0 && cash >= managed) {
            IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
            ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.DEPOSIT, getPoolId(), _reserveToken, managed);
            _vault.managePoolBalance(ops);
        }
    }

    // solhint-disable-next-line func-name-mixedcase
    function ADDRESSES_PROVIDER() external view override returns (IPoolAddressesProvider) {
        return _addressesProvider;
    }

    // solhint-disable-next-line func-name-mixedcase
    function POOL() external view override returns (IPool) {
        return _lendingPool;
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
}
