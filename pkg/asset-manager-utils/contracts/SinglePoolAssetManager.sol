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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeCast.sol";

import "./IAssetManager.sol";

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

// solhint-disable private-vars-leading-underscore
abstract contract SinglePoolAssetManager is IAssetManager {
    using FixedPoint for uint256;
    using SafeCast for uint256;

    uint64 private constant ONE = 1e18;

    /// @notice The Balancer Vault contract
    IVault public immutable vault;

    /// @notice The id of the pool which owns this asset manager
    bytes32 public poolId;

    /// @notice The token which this asset manager is investing
    IERC20 public immutable token;

    /// @notice the total AUM of tokens that the asset manager is aware it has earned
    uint256 public totalAUM;

    PoolConfig private _poolConfig;

    constructor(
        IVault _vault,
        bytes32 _poolId,
        IERC20 _token
    ) {
        vault = _vault;
        poolId = _poolId;
        token = _token;
        _token.approve(address(_vault), type(uint256).max);
    }

    modifier onlyPool() {
        address poolAddress = address((uint256(poolId) >> (12 * 8)) & (2**(20 * 8) - 1));
        require(msg.sender == poolAddress, "Only callable by pool controller");
        _;
    }

    modifier withCorrectPool(bytes32 pId) {
        require(pId == poolId, "SinglePoolAssetManager called with incorrect poolId");
        require(pId != bytes32(0), "Pool Id cannot be empty");
        _;
    }

    function _initialise(bytes32 pId) internal {
        require(poolId == bytes32(0), "Already initialised");
        require(pId != bytes32(0), "Pool id cannot be empty");
        poolId = pId;
    }

    // Investment configuration
    function _getTargetInvestment(
        uint256 cash,
        uint256 managed,
        uint256 investablePercent
    ) private pure returns (uint256) {
        return (cash + managed).mulDown(investablePercent);
    }

    function maxInvestableBalance(bytes32 pId) public view override withCorrectPool(pId) returns (int256) {
        return _maxInvestableBalance(readAUM());
    }

    function _maxInvestableBalance(uint256 aum) internal view returns (int256) {
        (uint256 poolCash, , , ) = vault.getPoolTokenInfo(poolId, token);
        // Calculate the managed portion of funds locally as the Vault is unaware of returns
        return int256(_getTargetInvestment(poolCash, aum, _poolConfig.targetPercentage)) - int256(aum);
    }

    // Reporting

    function updateBalanceOfPool(bytes32 pId) public override withCorrectPool(pId) {
        uint256 managedBalance = readAUM();

        IVault.PoolBalanceOp memory transfer = IVault.PoolBalanceOp(
            IVault.PoolBalanceOpKind.UPDATE,
            poolId,
            token,
            managedBalance
        );
        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
        ops[0] = (transfer);

        vault.managePoolBalance(ops);
    }

    // Deposit / Withdraw

    function capitalIn(bytes32 pId, uint256 amount) public override withCorrectPool(pId) {
        uint256 aum = readAUM();

        int256 maxAmountIn = _maxInvestableBalance(aum);
        require(maxAmountIn >= amount.toInt256(), "investment amount exceeds target");

        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
        // Update the vault with new managed balance accounting for returns
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, poolId, token, aum);
        // Pull funds from the vault
        ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, poolId, token, amount);

        vault.managePoolBalance(ops);

        _invest(amount, aum);

        // Update with gains and add deposited tokens from AUM
        totalAUM = aum.add(amount);
    }

    function capitalOut(bytes32 pId, uint256 amount) public override withCorrectPool(pId) {
        uint256 aum = readAUM();

        _divest(amount, aum);

        int256 maxAmountOut = -1 * _maxInvestableBalance(aum);
        require(maxAmountOut >= amount.toInt256(), "withdrawal leaves insufficient balance invested");

        // Update with gains and remove withdrawn tokens from AUM
        totalAUM = aum.sub(amount);

        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
        // Send funds back to the vault
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.DEPOSIT, poolId, token, amount);
        // Update the vault with new managed balance accounting for returns
        ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, poolId, token, totalAUM);

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

    // TODO restrict access with onlyPool
    function setPoolConfig(bytes32 pId, PoolConfig calldata config) external override withCorrectPool(pId) {
        require(pId == poolId, "poolId mismatch");
        require(config.targetPercentage <= ONE, "Investment target must be less than 100%");
        require(config.criticalPercentage <= config.targetPercentage, "Critical level must be less than target");
        require(config.feePercentage <= ONE / 10, "Fee on critical rebalances must be less than 10%");

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
        uint256 criticalManagedBalance = (poolCash + poolManaged).mulDown(config.criticalPercentage);
        if (poolManaged >= criticalManagedBalance) {
            return 0;
        }
        return criticalManagedBalance.sub(poolManaged).mulDown(config.feePercentage);
    }

    /**
     * @notice Rebalances funds between pool and asset manager to maintain target investment percentage.
     * @return feeAmount - the amount of tokens to be made available to msg.sender as a fee
     */
    function _rebalance() internal returns (uint256 feeAmount) {
        uint256 aum = readAUM();
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(aum);
        PoolConfig memory config = _poolConfig;

        uint256 targetInvestment = (poolCash + poolManaged).mulDown(config.targetPercentage);
        if (targetInvestment > poolManaged) {
            // Pool is under-invested so add more funds
            uint256 rebalanceAmount = targetInvestment.sub(poolManaged);

            // If pool is above critical threshold then we want to pay a fee to rebalancer
            // The fee is paid on the portion of managed funds which are above the critical threshold
            feeAmount = _getRebalanceFee(poolCash, poolManaged, config);

            // As paying out fees reduces the TVL of the pool, we must correct the amount invested to account for this
            capitalIn(poolId, rebalanceAmount.sub(feeAmount.mulDown(config.targetPercentage)));
        } else {
            // Pool is over-invested so remove some funds
            // Incentivising rebalancer is unneccessary as removing capital
            // will expose an arb opportunity if it is limiting trading.
            capitalOut(poolId, poolManaged.sub(targetInvestment));
        }
    }

    function rebalance(bytes32 pId) external override withCorrectPool(pId) {
        uint256 rebalancerFee = _rebalance();

        if (rebalancerFee > 0) {
            // Pull funds from the vault
            IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](1);
            ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, poolId, token, rebalancerFee);
            vault.managePoolBalance(ops);

            // Send fee to rebalancer
            token.transfer(msg.sender, rebalancerFee);
        }
    }

    function realizeGains() public override {
        totalAUM = readAUM();
    }

    function balanceOf(bytes32 pId) public view override withCorrectPool(pId) returns (uint256) {
        return totalAUM;
    }
}
