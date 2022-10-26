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

pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeeSplitter.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeesWithdrawer.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IProtocolFeesCollector.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IBasePool.sol";

/**
 * @dev This contract is responsible for splitting the BPT profits collected
 * by ProtocolFeeCollector between the pool's owner and Balancers DAO treasury
 * Nothing happens for non-BPT tokens (WETH, WBTC, etc...)
 */
contract ProtocolFeeSplitter is IProtocolFeeSplitter, Authentication {
    using FixedPoint for uint256;

    // All fee percentages are 18-decimal fixed point numbers.
    // Absolute maximum fee percentage (1e18 = 100%).
    uint256 private constant _MAX_REVENUE_SHARING_FEE_PERCENTAGE = 50e16; // 50%

    IProtocolFeesWithdrawer private immutable _protocolFeesWithdrawer;

    // Balancer vault
    IVault private immutable _vault;

    // Balancer DAO Multisig
    address private _treasury;

    // Can be updated by BAL governance (1e18 = 100%, 1e16 = 1%).
    uint256 private _defaultRevenueSharingFeePercentage;

    // poolId => PoolSettings
    mapping(bytes32 => RevenueShareSettings) private _poolSettings;

    constructor(IProtocolFeesWithdrawer protocolFeesWithdrawer, address treasury)
        // The ProtocolFeeSplitter is a singleton, so it simply uses its own address to disambiguate action
        // identifiers.
        Authentication(bytes32(uint256(address(this))))
    {
        _protocolFeesWithdrawer = protocolFeesWithdrawer;
        _treasury = treasury;
        _vault = protocolFeesWithdrawer.getProtocolFeesCollector().vault();
    }

    function setRevenueSharingFeePercentage(bytes32 poolId, uint256 newSwapFeePercentage)
        external
        override
        authenticate
    {
        _require(newSwapFeePercentage <= _MAX_REVENUE_SHARING_FEE_PERCENTAGE, Errors.SPLITTER_FEE_PERCENTAGE_TOO_HIGH);
        _poolSettings[poolId].revenueSharePercentageOverride = uint96(newSwapFeePercentage);
        emit PoolRevenueShareChanged(poolId, newSwapFeePercentage);
    }

    function setDefaultRevenueSharingFeePercentage(uint256 feePercentage) external override authenticate {
        _require(feePercentage <= _MAX_REVENUE_SHARING_FEE_PERCENTAGE, Errors.SPLITTER_FEE_PERCENTAGE_TOO_HIGH);
        _defaultRevenueSharingFeePercentage = feePercentage;
        emit DefaultRevenueSharingFeePercentageChanged(feePercentage);
    }

    function setTreasury(address newTreasury) external override authenticate {
        _treasury = newTreasury;
        emit TreasuryChanged(newTreasury);
    }

    function setPoolBeneficiary(bytes32 poolId, address newBeneficiary) external override {
        (address pool, ) = _vault.getPool(poolId);
        _require(msg.sender == IBasePool(pool).getOwner(), Errors.SENDER_NOT_ALLOWED);
        _poolSettings[poolId].beneficiary = newBeneficiary;
        emit PoolBeneficiaryChanged(poolId, newBeneficiary);
    }

    function collectFees(bytes32 poolId) external override returns (uint256 beneficiaryAmount, uint256 treasuryAmount) {
        (address pool, ) = _vault.getPool(poolId);
        IERC20 bpt = IERC20(pool);
        address beneficiary = _poolSettings[poolId].beneficiary;

        (beneficiaryAmount, treasuryAmount) = _getAmounts(bpt, poolId);

        if (beneficiaryAmount != 0) {
            _withdrawBpt(bpt, beneficiaryAmount, beneficiary);
        }

        _withdrawBpt(bpt, treasuryAmount, _treasury);
        emit FeesCollected(poolId, beneficiary, beneficiaryAmount, _treasury, treasuryAmount);
    }

    function getAmounts(bytes32 poolId)
        external
        view
        override
        returns (uint256 beneficiaryAmount, uint256 treasuryAmount)
    {
        (address pool, ) = _vault.getPool(poolId);
        IERC20 bpt = IERC20(pool);

        return _getAmounts(bpt, poolId);
    }

    function getProtocolFeesWithdrawer() external view override returns (IProtocolFeesWithdrawer) {
        return _protocolFeesWithdrawer;
    }

    function getDefaultRevenueSharingFeePercentage() external view override returns (uint256) {
        return _defaultRevenueSharingFeePercentage;
    }

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getTreasury() external view override returns (address) {
        return _treasury;
    }

    function getPoolSettings(bytes32 poolId) external view override returns (RevenueShareSettings memory) {
        return _poolSettings[poolId];
    }

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return _getAuthorizer().canPerform(actionId, account, address(this));
    }

    function _getAuthorizer() internal view returns (IAuthorizer) {
        return _protocolFeesWithdrawer.getProtocolFeesCollector().getAuthorizer();
    }

    function _withdrawBpt(
        IERC20 bpt,
        uint256 amount,
        address to
    ) private {
        IERC20[] memory tokens = new IERC20[](1);
        uint256[] memory amounts = new uint256[](1);
        tokens[0] = bpt;
        amounts[0] = amount;
        _protocolFeesWithdrawer.withdrawCollectedFees(tokens, amounts, to);
    }

    function _getAmounts(IERC20 bpt, bytes32 poolId)
        private
        view
        returns (uint256 beneficiaryAmount, uint256 treasuryAmount)
    {
        IProtocolFeesWithdrawer protocolFeesWithdrawer = _protocolFeesWithdrawer;
        uint256 feeCollectorBptBalance = bpt.balanceOf(address(protocolFeesWithdrawer.getProtocolFeesCollector()));
        if (feeCollectorBptBalance == 0) {
            return (0, 0);
        }

        address beneficiary = _poolSettings[poolId].beneficiary;
        if (beneficiary == address(0)) {
            return (0, feeCollectorBptBalance);
        }

        (beneficiaryAmount, treasuryAmount) = _computeAmounts(
            feeCollectorBptBalance,
            _getPoolBeneficiaryFeePercentage(poolId)
        );
    }

    function _computeAmounts(uint256 feeCollectorBptBalance, uint256 feePercentage)
        private
        pure
        returns (uint256 ownerAmount, uint256 treasuryAmount)
    {
        ownerAmount = FixedPoint.divDown(FixedPoint.mulDown(feeCollectorBptBalance, feePercentage), 1e18);
        treasuryAmount = feeCollectorBptBalance.sub(ownerAmount);
    }

    function _getPoolBeneficiaryFeePercentage(bytes32 poolId) private view returns (uint256) {
        uint256 poolFeeOverride = _poolSettings[poolId].revenueSharePercentageOverride;
        uint256 feePercentage = poolFeeOverride != 0 ? poolFeeOverride : _defaultRevenueSharingFeePercentage;
        return feePercentage;
    }
}
