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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./IAssetManager.sol";

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

/**
 * @title RewardsAssetManager
 * @dev RewardsAssetManager is owned by a single pool such that any
 * rewards received by the Asset Manager may be distributed to LPs
 *
 * Note: any behaviour to claim these rewards must be implemented in a derived contract
 */
abstract contract RewardsAssetManager is IAssetManager {
    using Math for uint256;

    /// @notice The Balancer Vault contract
    IVault public immutable vault;

    /// @notice The id of the pool which owns this asset manager
    bytes32 public poolId;

    /// @notice The token which this asset manager is investing
    IERC20 public immutable token;

    PoolConfig private _poolConfig;

    constructor(
        IVault _vault,
        bytes32 _poolId,
        IERC20 _token
    ) {
        _token.approve(address(_vault), type(uint256).max);
        vault = _vault;
        poolId = _poolId;
        token = _token;
    }

    modifier onlyPoolController() {
        address poolAddress = address((uint256(poolId) >> (12 * 8)) & (2**(20 * 8) - 1));
        require(msg.sender == poolAddress, "Only callable by pool controller");
        _;
    }

    modifier withCorrectPool(bytes32 pId) {
        require(pId == poolId, "SinglePoolAssetManager called with incorrect poolId");
        require(pId != bytes32(0), "Pool id cannot be empty");
        _;
    }

    function _initialise(bytes32 pId) internal {
        require(poolId == bytes32(0), "Already initialised");
        require(pId != bytes32(0), "Pool id cannot be empty");
        poolId = pId;
    }

    // Investment configuration

    function maxInvestableBalance(bytes32 pId) public view override withCorrectPool(pId) returns (int256) {
        return _maxInvestableBalance(readAUM());
    }

    function _maxInvestableBalance(uint256 aum) internal view returns (int256) {
        (uint256 poolCash, , , ) = vault.getPoolTokenInfo(poolId, token);
        // Calculate the managed portion of funds locally as the Vault is unaware of returns
        return int256(FixedPoint.mulDown(poolCash.add(aum), _poolConfig.targetPercentage)) - int256(aum);
    }

    // Reporting

    function updateBalanceOfPool(bytes32 pId) public override withCorrectPool(pId) {
        uint256 managedBalance = readAUM();

        IVault.PoolBalanceOp memory transfer = IVault.PoolBalanceOp(
            IVault.PoolBalanceOpKind.UPDATE,
            pId,
            token,
            managedBalance
        );
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
        ops[0] = (transfer);

        vault.managePoolBalance(ops);
    }

    // Deposit / Withdraw

    /**
     * @dev Transfers capital into the asset manager, and then invests it
     * @param pId - the id of the pool depositing funds into this asset manager
     * @param amount - the amount of tokens being deposited
     */
    function capitalIn(bytes32 pId, uint256 amount) public override withCorrectPool(pId) {
        uint256 aum = readAUM();
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(aum);
        uint256 targetInvestment = FixedPoint.mulDown(poolCash + poolManaged, _poolConfig.targetPercentage);

        require(targetInvestment >= poolManaged.add(amount), "investment amount exceeds target");

        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
        // Update the vault with new managed balance accounting for returns
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, pId, token, poolManaged);
        // Pull funds from the vault
        ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, pId, token, amount);

        vault.managePoolBalance(ops);

        _invest(amount, aum);
    }

    /**
     * @notice Divests capital back to the asset manager and then sends it to the vault
     * @param pId - the id of the pool withdrawing funds from this asset manager
     * @param amount - the amount of tokens to withdraw to the vault
     */
    function capitalOut(bytes32 pId, uint256 amount) public override withCorrectPool(pId) {
        uint256 aum = readAUM();
        uint256 tokensOut = _divest(amount, aum);
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(aum);
        uint256 targetInvestment = FixedPoint.mulDown(poolCash + poolManaged, _poolConfig.targetPercentage);

        require(poolManaged >= targetInvestment.add(tokensOut), "withdrawal leaves insufficient balance invested");

        // As we have now updated totalAUM and burned the pool's shares
        // calling balanceOf(poolId) will now return the pool's managed balance post-withdrawal

        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
        // Send funds back to the vault
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.DEPOSIT, pId, token, tokensOut);
        // Update the vault with new managed balance accounting for returns
        ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, pId, token, aum.sub(tokensOut));

        vault.managePoolBalance(ops);
    }

    /**
     * @dev Invests capital inside the asset manager
     * @param amount - the amount of tokens being deposited
     * @param aum - the assets under management
     * @return the number of tokens that were deposited
     */
    function _invest(uint256 amount, uint256 aum) internal virtual returns (uint256);

    /**
     * @dev Divests capital back to the asset manager
     * @param amount - the amount of tokens being withdrawn
     * @return the number of tokens to return to the vault
     */
    function _divest(uint256 amount, uint256 aum) internal virtual returns (uint256);

    function readAUM() public view virtual override returns (uint256);

    // TODO restrict access with onlyPoolController
    function setPoolConfig(bytes32 pId, PoolConfig calldata config) external override withCorrectPool(pId) {
        require(
            config.upperCriticalPercentage <= FixedPoint.ONE,
            "Upper critical level must be less than or equal to 100%"
        );
        require(
            config.targetPercentage <= config.upperCriticalPercentage,
            "Target must be less than or equal to upper critical level"
        );
        require(
            config.lowerCriticalPercentage <= config.targetPercentage,
            "Lower critical level must be less than or equal to target"
        );
        require(
            config.feePercentage <= FixedPoint.ONE / 10,
            "Fee on critical rebalances must be less than or equal to 10%"
        );

        _poolConfig = config;
    }

    function getPoolConfig(bytes32 pId) external view override withCorrectPool(pId) returns (PoolConfig memory) {
        return _poolConfig;
    }

    function _getPoolBalances(uint256 aum) internal view returns (uint256 poolCash, uint256 poolManaged) {
        (poolCash, , , ) = vault.getPoolTokenInfo(poolId, token);
        // Calculate the managed portion of funds locally as the Vault is unaware of returns
        poolManaged = aum;
    }

    function getRebalanceFee(bytes32 pId) external view override withCorrectPool(pId) returns (uint256) {
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(readAUM());
        return _getRebalanceFee(poolCash, poolManaged, _poolConfig);
    }

    function _getRebalanceFee(
        uint256 poolCash,
        uint256 poolManaged,
        PoolConfig memory config
    ) internal pure returns (uint256) {
        uint256 amountSubjectToFees = 0;

        uint256 upperCriticalManagedBalance = FixedPoint.mulDown(
            poolCash + poolManaged,
            config.upperCriticalPercentage
        );
        if (poolManaged > upperCriticalManagedBalance) {
            amountSubjectToFees = poolManaged.sub(upperCriticalManagedBalance);
        }

        uint256 lowerCriticalManagedBalance = FixedPoint.mulDown(
            poolCash + poolManaged,
            config.lowerCriticalPercentage
        );
        if (poolManaged < lowerCriticalManagedBalance) {
            amountSubjectToFees = lowerCriticalManagedBalance.sub(poolManaged);
        }

        return FixedPoint.mulDown(amountSubjectToFees, config.feePercentage);
    }

    /**
     * @notice withdraw `amount` of cash from the Vault, reducing the pool's TVL
     * @dev When withdrawing `amount` will be moved from the pool's cash to managed balance
     * As these funds are to be paid as fees (and so lost) we then remove this from the managed balance
     */
    function _withdrawCashFromVault(uint256 amount) private {
        // Pull funds from the vault and update balance to reflect that the fee is no longer part of managed funds
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, poolId, token, amount);
        ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, poolId, token, readAUM().sub(amount));

        vault.managePoolBalance(ops);
    }

    /**
     * @notice Rebalances funds between pool and asset manager to maintain target investment percentage.
     * @return feeAmount - the amount of tokens to be made available to msg.sender as a fee
     */
    function _rebalance(
        bytes32 /*pId*/
    ) internal returns (uint256 feeAmount) {
        uint256 aum = readAUM();
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(aum);
        PoolConfig memory config = _poolConfig;

        uint256 targetInvestment = FixedPoint.mulDown(poolCash + poolManaged, config.targetPercentage);
        if (targetInvestment > poolManaged) {
            // Pool is under-invested so add more funds
            uint256 rebalanceAmount = targetInvestment.sub(poolManaged);

            // If pool is above critical threshold then we want to pay a fee to rebalancer
            // The fee is paid on the portion of managed funds which are above the critical threshold
            feeAmount = _getRebalanceFee(poolCash, poolManaged, config);

            // As paying out fees reduces the TVL of the pool, we must correct the amount invested to account for this
            capitalIn(poolId, rebalanceAmount.sub(FixedPoint.mulDown(feeAmount, config.targetPercentage)));
        } else {
            // Pool is over-invested so remove some funds
            uint256 rebalanceAmount = poolManaged.sub(targetInvestment);

            // If pool is below critical threshold then we want to pay a fee to rebalancer
            // The fee is paid on the portion of managed funds which are below the critical threshold
            feeAmount = _getRebalanceFee(poolCash, poolManaged, config);

            capitalOut(poolId, rebalanceAmount.sub(FixedPoint.mulDown(feeAmount, config.targetPercentage)));
        }
    }

    function rebalance(bytes32 pId) external override withCorrectPool(pId) {
        uint256 rebalancerFee = _rebalance(pId);

        if (rebalancerFee > 0) {
            _withdrawCashFromVault(rebalancerFee);

            // Send fee to rebalancer
            token.transfer(msg.sender, rebalancerFee);
        }
    }

    struct BatchSwap {
        IVault.BatchSwapStep[] swaps;
        IAsset[] assets;
        IVault.FundManagement funds;
        int256[] limits;
        uint256 deadline;
    }

    /**
     * @notice Rebalances funds between pool and asset manager to maintain target investment percentage.
     * Any reward from rebalancing the pool is immediately used in the provided batch swap.
     */
    function rebalanceAndSwap(bytes32 pId, BatchSwap memory swap) external withCorrectPool(pId) {
        uint256 rebalancerFee = _rebalance(pId);

        if (rebalancerFee > 0) {
            _withdrawCashFromVault(rebalancerFee);

            // Ensure that we use the full fee as input to the swap
            swap.swaps[0].amount = rebalancerFee;
            require(swap.funds.sender == address(this), "Asset Manager must be sender");
            require(!swap.funds.fromInternalBalance, "Can't use Asset Manager's internal balance");
            require(
                address(swap.assets[swap.swaps[0].assetInIndex]) == address(token),
                "Must swap asset manager's token"
            );
            vault.batchSwap(IVault.SwapKind.GIVEN_IN, swap.swaps, swap.assets, swap.funds, swap.limits, swap.deadline);
        }
    }

    function balanceOf(bytes32 pId) public view override withCorrectPool(pId) returns (uint256) {
        return readAUM();
    }
}
