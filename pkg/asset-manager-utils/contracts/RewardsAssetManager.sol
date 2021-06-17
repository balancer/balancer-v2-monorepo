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

    struct InvestmentConfig {
        uint64 targetPercentage;
        uint64 upperCriticalPercentage;
        uint64 lowerCriticalPercentage;
    }

    InvestmentConfig private _config;

    event InvestmentConfigSet(uint64 targetPercentage, uint64 lowerCriticalPercentage, uint64 upperCriticalPercentage);

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

    function getToken() external view override returns (IERC20) {
        return token;
    }

    // Investment configuration

    function maxInvestableBalance(bytes32 pId) public view override withCorrectPool(pId) returns (int256) {
        return _maxInvestableBalance(_getAUM());
    }

    function _maxInvestableBalance(uint256 aum) internal view returns (int256) {
        (uint256 poolCash, , , ) = vault.getPoolTokenInfo(poolId, token);
        // Calculate the managed portion of funds locally as the Vault is unaware of returns
        return int256(FixedPoint.mulDown(poolCash.add(aum), _config.targetPercentage)) - int256(aum);
    }

    // Reporting

    function updateBalanceOfPool(bytes32 pId) public override withCorrectPool(pId) {
        uint256 managedBalance = _getAUM();

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
        uint256 aum = _getAUM();
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(aum);
        uint256 targetInvestment = FixedPoint.mulDown(poolCash + poolManaged, _config.targetPercentage);

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
        uint256 aum = _getAUM();
        uint256 tokensOut = _divest(amount, aum);
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(aum);
        uint256 targetInvestment = FixedPoint.mulDown(poolCash + poolManaged, _config.targetPercentage);

        require(poolManaged >= targetInvestment.add(tokensOut), "withdrawal leaves insufficient balance invested");

        IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
        // Update the vault with new managed balance accounting for returns
        ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, pId, token, aum);
        // Send funds back to the vault
        ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.DEPOSIT, pId, token, tokensOut);

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

    function getAUM(bytes32 pId) public view virtual override withCorrectPool(pId) returns (uint256) {
        return _getAUM();
    }

    function _getAUM() internal view virtual returns (uint256);

    // TODO restrict access with onlyPoolController
    function setConfig(bytes32 pId, bytes memory rawConfig) external override withCorrectPool(pId) {
        InvestmentConfig memory config = abi.decode(rawConfig, (InvestmentConfig));

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

        _config = config;
        emit InvestmentConfigSet(
            config.targetPercentage,
            config.lowerCriticalPercentage,
            config.upperCriticalPercentage
        );
    }

    function getInvestmentConfig(bytes32 pId) external view withCorrectPool(pId) returns (InvestmentConfig memory) {
        return _config;
    }

    function getPoolBalances(bytes32 pId)
        public
        view
        override
        withCorrectPool(pId)
        returns (uint256 poolCash, uint256 poolManaged)
    {
        return _getPoolBalances(_getAUM());
    }

    function _getPoolBalances(uint256 aum) internal view returns (uint256 poolCash, uint256 poolManaged) {
        (poolCash, , , ) = vault.getPoolTokenInfo(poolId, token);
        // Calculate the managed portion of funds locally as the Vault is unaware of returns
        poolManaged = aum;
    }

    /**
     * @notice Rebalances funds between pool and asset manager to maintain target investment percentage.
     */
    function _rebalance(
        bytes32 /*pId*/
    ) internal {
        uint256 aum = _getAUM();
        (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(aum);
        InvestmentConfig memory config = _config;

        uint256 targetInvestment = FixedPoint.mulDown(poolCash + poolManaged, config.targetPercentage);
        if (targetInvestment > poolManaged) {
            // Pool is under-invested so add more funds
            uint256 rebalanceAmount = targetInvestment.sub(poolManaged);
            capitalIn(poolId, rebalanceAmount);
        } else {
            // Pool is over-invested so remove some funds
            uint256 rebalanceAmount = poolManaged.sub(targetInvestment);
            capitalOut(poolId, rebalanceAmount);
        }

        emit Rebalance(poolId);
    }

    function rebalance(bytes32 pId, bool force) external override withCorrectPool(pId) {
        if (force) {
            _rebalance(pId);
        } else {
            (uint256 poolCash, uint256 poolManaged) = _getPoolBalances(_getAUM());
            InvestmentConfig memory config = _config;

            uint256 investedPercentage = poolManaged.mul(FixedPoint.ONE).divDown(poolCash + poolManaged);
            if (
                investedPercentage > config.upperCriticalPercentage ||
                investedPercentage < config.lowerCriticalPercentage
            ) {
                _rebalance(pId);
            }
        }
    }
}
