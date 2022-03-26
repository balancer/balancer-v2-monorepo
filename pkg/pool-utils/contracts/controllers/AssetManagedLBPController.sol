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
 * @dev Controller for an unseeded LiquidityBootstrappingPool. It also serves as the asset manager.
 * Using the `UnseededLiquidityBootstrappingPoolFactory` will deploy this controller and a pool.
 * After the contracts are deployed by the factory, the manager can call `fundPool` on the controller
 * with the initial balances.
 *
 * The result is an apparently fully funded pool, but with a zero cash balance in the reserve token.
 * This means project tokens cannot be "sold back" into the pool - at least until enough are sold to
 * build up the real balance.
 *
 * The controller can then be used by the manager for regular LBP functions.
 */
contract AssetManagedLBPController is BasePoolController {
    using FixedPoint for uint256;

    // WeightedPoolUserData type - duplicating here to avoid a circular dependency
    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT }

    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_TOKENS_OUT }

    IVault private immutable _vault;
    // LBPs are always two tokens: project and reserve
    IERC20 private immutable _projectToken;

    IERC20 private immutable _reserveToken;

    // The tokens are numerically sorted, so could be in either order
    uint256 private immutable _projectTokenIndex;

    uint256 private immutable _reserveTokenIndex;

    constructor(
        BasePoolRights memory baseRights,
        IVault vault,
        IERC20 projectToken,
        IERC20 reserveToken,
        address manager
    ) BasePoolController(encodePermissions(baseRights), manager) {
        _projectToken = projectToken;
        _reserveToken = reserveToken;
        _vault = vault;

        bool projectTokenFirst = projectToken < reserveToken;
        _projectTokenIndex = projectTokenFirst ? 0 : 1;
        _reserveTokenIndex = projectTokenFirst ? 1 : 0;
    }

    /**
     * @dev Call this function instead of the usual `joinPool` (init). It will set the managed balance equal to what
     * would otherwise be deposited in cash, so that pool initialization and trading work. Initially, project tokens
     * cannot be "sold back" into the pool, since the cash balance is zero. Withdrawing liquidity will also fail
     * while the cash balance is insufficient.
     */
    function fundPool(uint256[] memory initialBalances) external onlyManager withBoundPool {
        uint256 virtualAmount = initialBalances[_getReserveTokenIndex()];

        // Set the total to the virtual balance we need
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, getPoolId(), _getReserveToken(), virtualAmount);
        _vault.managePoolBalance(ops);

        uint256 projectTokenAmount = initialBalances[_getProjectTokenIndex()];

        // Pull project tokens from the manager
        _getProjectToken().transferFrom(getManager(), address(this), projectTokenAmount);

        // We are *apparently* joining with all tokens (initialBalances includes the reserve token)
        // This is necessary for the invariant calculations and initial BPT minting
        // `_onInitialize` in the pool checks if there is a managed balance: if there is, it passes
        // zero to the Vault in amountsIn for the reserve token.

        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(getPoolId());

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: initialBalances,
            userData: abi.encode(JoinKind.INIT, initialBalances),
            fromInternalBalance: false
        });

        _getProjectToken().approve(address(_vault), projectTokenAmount);

        // Fund the pool; pull the tokens from this contract, send BPT to the manager
        _vault.joinPool(getPoolId(), address(this), getManager(), request);

        // Sanity check that the funding worked
        (, uint256[] memory balances, ) = _vault.getPoolTokens(getPoolId());

        _require(balances[_getProjectTokenIndex()] == projectTokenAmount, Errors.INVALID_INITIALIZATION);
        _require(balances[_getReserveTokenIndex()] == virtualAmount, Errors.INVALID_INITIALIZATION);
    }

    /**
     * @dev Allow manager to add liquidity in any desired proportion.
     */
    function addLiquidity(uint256[] memory amountsIn, uint256 minBptOut) external onlyManager withBoundPool {
        uint256 projectTokenAmount = amountsIn[_getProjectTokenIndex()];
        uint256 reserveTokenAmount = amountsIn[_getReserveTokenIndex()];

        if (projectTokenAmount > 0) {
            _getProjectToken().transferFrom(getManager(), address(this), projectTokenAmount);

            _getProjectToken().approve(address(_vault), projectTokenAmount);
        }

        if (reserveTokenAmount > 0) {
            _getReserveToken().transferFrom(getManager(), address(this), reserveTokenAmount);

            _getReserveToken().approve(address(_vault), reserveTokenAmount);
        }

        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(getPoolId());

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: amountsIn,
            userData: abi.encode(JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, amountsIn, minBptOut),
            fromInternalBalance: false
        });

        _vault.joinPool(getPoolId(), address(this), getManager(), request);
    }

    /**
     * @dev Allow the manager to remove liquidity proportionally.
     */
    function removeLiquidity(
        uint256 bptAmountIn,
        uint256[] memory minAmountsOut,
        address recipient
    ) external onlyManager withBoundPool {
        // Pull BPT from manager
        IERC20(pool).transferFrom(getManager(), address(this), bptAmountIn);

        IERC20(pool).approve(address(_vault), bptAmountIn);

        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(getPoolId());
        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest({
            assets: _asIAsset(tokens),
            minAmountsOut: minAmountsOut,
            userData: abi.encode(ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptAmountIn),
            toInternalBalance: false
        });

        _vault.exitPool(getPoolId(), address(this), payable(recipient), request);
    }

    /**
     * @dev The initial funding results in a non-zero managed balance. This allows the pool to "sell" project tokens
     * for the reserve immediately, though removing liquidity or selling project tokens "back" to the pool would fail
     * until there was a sufficient cash balance.
     *
     * The total balance is the sum of the cash and managed balances, which means the price of the project token in
     * terms of the reserve will be artificially higher, in proportion to the amount "borrowed" in the beginning.
     *
     * At any time, the manager can "repay" the initial "loan" by setting the managed funds to zero. If the rebalance
     * flag is set, adjust the weights to keep the prices constant. Otherwise, the prices will change, so halt trading
     * as a safety measure.
     */
    function repaySeedFunds(bool rebalance) external onlyManager withBoundPool {
        (uint256 cash, uint256 managed, , ) = _vault.getPoolTokenInfo(getPoolId(), _getReserveToken());

        // If there is no managed balance, there is nothing to do
        // Cash must also be > 0, or the total balance would become zero, which is invalid
        if (managed == 0 || cash == 0) {
            return;
        }

        if (rebalance) {
            // Calculate weight adjustment necessary to compensate for removing the managed balance
            uint256[] memory endWeights = _calculateRebalancedWeights(cash);

            // solhint-disable-next-line not-rely-on-time
            uint256 currentTime = block.timestamp;

            // Update weights (instantaneously)
            IControlledLiquidityBootstrappingPool(pool).updateWeightsGradually(currentTime, currentTime, endWeights);
        } else {
            // If we are not rebalancing, prices will change, so halt trading
            IControlledLiquidityBootstrappingPool(pool).setSwapEnabled(false);
        }

        // Set managed balance to zero
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, getPoolId(), _getReserveToken(), 0);
        _vault.managePoolBalance(ops);
    }

    // Returns the weights required to compensate for removing the managed reserve balance
    function _calculateRebalancedWeights(uint256 reserveCashAmount) private returns (uint256[] memory endWeights) {
        // The spot price of the project token in terms of the reserve should remain constant
        // Br and Bp are the reserve and project balances, respectively
        // Wr and Wp are the corresponding weights
        //
        // So the spot price is given by: Br/Wr / Bp/Wp = Br/Wr * Wp/Bp = Br/Wr * Wp/Bp
        // Br is make of up the real cash balance plus the "virtual" managed balance
        // When we set the managed balance to 0, Br will decrease:
        // Bc = Br - Bv (new balance = old balance - virtual balance)
        //
        // Let the new weights be Wr' and Wp'; the new spot is the Bc/Wr' * Wp'/Bp
        // The new spot price must equal the old spot price, so:
        // Br/Wr * Wp/Bp = Bc/Wr' * Wp'/Bp
        // And of course, Wr' + Wp' = 1, so we have two equations and two unknowns
        // Wp' = 1 - Wr', so:
        // Br/Wr * Wp/Bp = Bc/Wr' * (1 - Wr')/Bp
        //
        // Solving for Wr':
        // Br/Bc * Wp/Wr = (1 - Wr')/Wr'
        // Everything on the left side is known, so set k = Br/Bc * Wp/Wr
        // k = (1 - Wr')/Wr'
        // Wr' = 1/(k + 1), and then Wp' = 1 - Wr'

        (, uint256[] memory balances, ) = _vault.getPoolTokens(getPoolId());
        uint256[] memory normalizedWeights = IControlledLiquidityBootstrappingPool(pool).getNormalizedWeights();
        uint256[] memory scalingFactors = IControlledLiquidityBootstrappingPool(pool).getScalingFactors();

        uint256 projectTokenWeight = normalizedWeights[_getProjectTokenIndex()];
        uint256 reserveTokenWeight = normalizedWeights[_getReserveTokenIndex()];

        // Calculate the new weight ratio (r)
        // r = Wp*Br / Wr*Bc (multiply first, for greater accuracy)
        uint256 numerator = projectTokenWeight.mulDown(
            _upscale(balances[_getReserveTokenIndex()], scalingFactors[_getReserveTokenIndex()])
        );
        uint256 denominator = reserveTokenWeight.mulUp(
            _upscale(reserveCashAmount, scalingFactors[_getReserveTokenIndex()])
        );

        uint256 k = numerator.divDown(denominator);

        endWeights = new uint256[](2);
        endWeights[_getReserveTokenIndex()] = FixedPoint.ONE.divDown(FixedPoint.ONE.add(k));
        endWeights[_getProjectTokenIndex()] = endWeights[_getReserveTokenIndex()].complement();
    }

    /**
     * @dev Applies `scalingFactor` to `amount`, resulting in a larger or equal value depending on whether it needed
     * scaling or not. (Copied from BasePool, where it is internal.)
     */
    function _upscale(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return FixedPoint.mulDown(amount, scalingFactor);
    }

    function _getProjectTokenIndex() internal view returns (uint256) {
        return _projectTokenIndex;
    }

    function _getReserveTokenIndex() internal view returns (uint256) {
        return _reserveTokenIndex;
    }

    function _getProjectToken() internal view returns (IERC20) {
        return _projectToken;
    }

    function _getReserveToken() internal view returns (IERC20) {
        return _reserveToken;
    }

    // LBP functions

    function setSwapEnabled(bool swapEnabled) external onlyManager withBoundPool {
        IControlledLiquidityBootstrappingPool(pool).setSwapEnabled(swapEnabled);
    }

    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external onlyManager withBoundPool {
        IControlledLiquidityBootstrappingPool(pool).updateWeightsGradually(startTime, endTime, endWeights);
    }
}
