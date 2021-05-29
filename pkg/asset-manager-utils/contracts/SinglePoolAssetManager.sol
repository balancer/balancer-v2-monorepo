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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeCast.sol";

import "./IAssetManager.sol";

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

// solhint-disable private-vars-leading-underscore
abstract contract SinglePoolAssetManager is IAssetManager {
    using Math for uint256;
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
        address _token
    ) {
        IERC20(_token).approve(address(_vault), type(uint256).max);
        vault = _vault;
        poolId = _poolId;
        token = IERC20(_token);
    }

    modifier onlyPoolController() {
        address poolAddress = address((uint256(poolId) >> (12 * 8)) & (2**(20 * 8) - 1));
        require(msg.sender == poolAddress, "Only callable by pool controller");
        _;
    }

    modifier correctPool(bytes32 pId) {
        require(pId == poolId, "SinglePoolAssetManager called with incorrect poolId");
        _;
    }

    // Investment configuration
    function _getTargetInvestment(
        uint256 cash,
        uint256 managed,
        uint256 investablePercent
    ) private pure returns (uint256) {
        return (cash + managed).mul(investablePercent).divDown(1e18);
    }

    /**
     * @return The difference in token between the target investment
     * and the currently invested amount (i.e. the amount that can be invested)
     */
    function maxInvestableBalance(bytes32 pId) public view override correctPool(pId) returns (int256) {
        return _maxInvestableBalance(readAUM());
    }

    /**
     * @return The difference in token between the target investment
     * and the currently invested amount (i.e. the amount that can be invested)
     */
    function _maxInvestableBalance(uint256 aum) internal view returns (int256) {
        (uint256 poolCash, , , ) = vault.getPoolTokenInfo(poolId, token);
        // Calculate the managed portion of funds locally as the Vault is unaware of returns
        return int256(_getTargetInvestment(poolCash, aum, _poolConfig.targetPercentage)) - int256(aum);
    }

    // Reporting

    /**
     * @notice Updates the Vault on the value of the pool's investment returns
     * @dev To be called following a call to realizeGains
     */
    function updateBalanceOfPool(bytes32 pId) public override correctPool(pId) {
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

    /**
     * @dev Transfers capital into the asset manager, and then invests it
     * @param amount - the amount of tokens being deposited
     */
    function capitalIn(bytes32 pId, uint256 amount) public override correctPool(pId) {
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

    /**
     * @notice Divests capital back to the asset manager and then sends it to the vault
     * @param amount - the amount of tokens to withdraw to the vault
     */
    function capitalOut(bytes32 pId, uint256 amount) public override correctPool(pId) {
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

    /**
     * @return the current assets under management of this asset manager
     */
    function readAUM() public view virtual override returns (uint256);

    // TODO restrict access with onlyPoolController
    function setPoolConfig(bytes32 pId, PoolConfig calldata config) external override correctPool(pId) {
        require(pId == poolId, "poolId mismatch");
        require(config.targetPercentage <= ONE, "Investment target must be less than 100%");
        require(config.criticalPercentage <= config.targetPercentage, "Critical level must be less than target");
        require(config.feePercentage <= ONE / 10, "Fee on critical rebalances must be less than 10%");

        _poolConfig = config;
    }

    function getPoolConfig(bytes32 pId) external view override correctPool(pId) returns (PoolConfig memory) {
        return _poolConfig;
    }

    function _getPoolBalances(uint256 aum) internal view returns (uint256 poolCash, uint256 poolManaged) {
        (poolCash, , , ) = vault.getPoolTokenInfo(poolId, token);
        // Calculate the managed portion of funds locally as the Vault is unaware of returns
        poolManaged = aum;
    }

    /**
     * @return the target investment percent for the pool
     */
    function getRebalanceFee(bytes32 pId) external view override correctPool(pId) returns (uint256) {
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(readAUM());
        return _getRebalanceFee(poolCash, poolManaged, _poolConfig);
    }

    /**
     * @return the target investment percent for the pool
     */
    function _getRebalanceFee(
        uint256 poolCash,
        uint256 poolManaged,
        PoolConfig memory config
    ) internal pure returns (uint256) {
        uint256 criticalManagedBalance = (poolCash + poolManaged).mul(config.criticalPercentage).divDown(ONE);
        if (poolManaged >= criticalManagedBalance) {
            return 0;
        }
        return criticalManagedBalance.sub(poolManaged).mul(config.feePercentage).divDown(ONE);
    }

    /**
     * @notice Rebalances funds between pool and asset manager to maintain target investment percentage.
     * @return feeAmount - the amount of tokens to be made available to msg.sender as a fee
     */
    function _rebalance() internal returns (uint256 feeAmount) {
        uint256 aum = readAUM();
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(aum);
        PoolConfig memory config = _poolConfig;

        uint256 targetInvestment = (poolCash + poolManaged).mul(config.targetPercentage).divDown(ONE);
        if (targetInvestment > poolManaged) {
            // Pool is under-invested so add more funds
            uint256 rebalanceAmount = targetInvestment.sub(poolManaged);

            // If pool is above critical threshold then we want to pay a fee to rebalancer
            // The fee is paid on the portion of managed funds which are above the critical threshold
            feeAmount = _getRebalanceFee(poolCash, poolManaged, config);

            // As paying out fees reduces the TVL of the pool, we must correct the amount invested to account for this
            capitalIn(poolId, rebalanceAmount.sub(feeAmount.mul(config.targetPercentage).divDown(ONE)));
        } else {
            // Pool is over-invested so remove some funds
            // Incentivising rebalancer is unneccessary as removing capital
            // will expose an arb opportunity if it is limiting trading.
            capitalOut(poolId, poolManaged.sub(targetInvestment));
        }
    }

    /**
     * @notice Rebalances funds between pool and asset manager to maintain target investment percentage.
     * If the pool is below it's critical threshold for the amount invested then calling this will send a small reward
     */
    function rebalance(bytes32 pId) external override correctPool(pId) {
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

    /**
     * @notice Checks invested balance and updates AUM appropriately
     */
    function realizeGains() public override {
        totalAUM = readAUM();
    }

    /**
     * @notice Returns invested balance
     */
    function balanceOf(bytes32 pId) public view override correctPool(pId) returns (uint256) {
        return totalAUM;
    }
}
