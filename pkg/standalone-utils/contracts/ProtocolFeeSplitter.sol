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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeeSplitter.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/VaultHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IProtocolFeesCollector.sol";

interface Pool {
    function getOwner() external returns (address);
}

/**
 * @dev This contract is responsible for splitting the BPT profits collected
 * by ProtocolFeeCollector between the pool's owner and Balancers DAO treasury
 * Nothing happens for non-BPT tokens (WETH, WBTC, etc...)
 */
contract ProtocolFeeSplitter is IProtocolFeeSplitter, Authentication {
    using Math for uint256;

    // All fee percentages are 18-decimal fixed point numbers.
    // Absolute maximum fee percentages (1e18 = 100%, 1e16 = 1%).
    uint256 private constant _MIN_REVENUE_SHARING_FEE_PERCENTAGE = 1e16; // 1%
    uint256 private constant _MAX_REVENUE_SHARING_FEE_PERCENTAGE = 50e16; // 50%
    address private constant _DELEGATE_OWNER = 0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B;

    IProtocolFeesCollector public immutable protocolFeesCollector;

    // Balancer DAO Multisig
    address public immutable treasury;

    // Can be updated by BAL governance (1e18 = 100%, 1e16 = 1%).
    uint256 public defaultRevenueSharingFeePercentage;

    // Allows for a pool revenue override
    mapping(bytes32 => uint256) public revenueSharePerPool;

    constructor(IProtocolFeesCollector _protocolFeesCollector, address _treasury)
        // The ProtocolFeeSplitter is a singleton, so it simply uses its own address to disambiguate action
        // identifiers.
        Authentication(bytes32(uint256(address(this))))
    {
        protocolFeesCollector = _protocolFeesCollector;
        treasury = _treasury;
    }

    function setRevenueSharingFeePercentage(bytes32 poolId, uint256 newSwapFeePercentage)
        external
        override
        authenticate
    {
        _require(newSwapFeePercentage >= _MIN_REVENUE_SHARING_FEE_PERCENTAGE, Errors.SPLITTER_FEE_PERCENTAGE_TOO_LOW);
        _require(newSwapFeePercentage <= _MAX_REVENUE_SHARING_FEE_PERCENTAGE, Errors.SPLITTER_FEE_PERCENTAGE_TOO_HIGH);
        revenueSharePerPool[poolId] = newSwapFeePercentage;
        emit PoolRevenueShareChanged(poolId, newSwapFeePercentage);
    }

    function setDefaultRevenueSharingFeePercentage(uint256 feePercentage) external override authenticate {
        _require(feePercentage <= _MAX_REVENUE_SHARING_FEE_PERCENTAGE, Errors.SPLITTER_FEE_PERCENTAGE_TOO_HIGH);
        defaultRevenueSharingFeePercentage = feePercentage;
        emit DefaultRevenueSharingFeePercentageChanged(feePercentage);
    }

    function collectFees(bytes32 poolId) external override {
        address pool = VaultHelpers.toPoolAddress(poolId);
        IERC20 bpt = IERC20(pool);

        IProtocolFeesCollector protocolFeesCollectorMemory = protocolFeesCollector;
        uint256 feeCollectorBptBalance = bpt.balanceOf(address(protocolFeesCollectorMemory));
        if (feeCollectorBptBalance == 0) {
            _revert(Errors.NO_BPT_FEES_COLLECTED);
        }

        // withdrawCollectedFees requires array of tokens, and we are only transfering BPT token
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = bpt;

        address poolOwner = Pool(pool).getOwner();

        if (poolOwner == address(0) || poolOwner == _DELEGATE_OWNER) {
            uint256[] memory amounts = new uint256[](1);
            amounts[0] = feeCollectorBptBalance;
            protocolFeesCollectorMemory.withdrawCollectedFees(tokens, amounts, treasury);
            emit FeesCollected(poolId, poolOwner, 0, treasury, feeCollectorBptBalance);
        } else {
            uint256[] memory amounts = new uint256[](1);

            uint256 poolFeeOverride = revenueSharePerPool[poolId];
            uint256 feePercentage = poolFeeOverride != 0 ? poolFeeOverride : defaultRevenueSharingFeePercentage;

            (uint256 ownerAmount, uint256 treasuryAmount) = _computeAmounts(feeCollectorBptBalance, feePercentage);

            // owner doesn't get the tokens always
            if (ownerAmount > 0) {
                // mutate array, and set the owner amount for owner withdrawal
                amounts[0] = ownerAmount;
                protocolFeesCollectorMemory.withdrawCollectedFees(tokens, amounts, poolOwner);
            }

            // mutate array, and set the treasury amount for treasury withdrawal
            amounts[0] = treasuryAmount;
            protocolFeesCollectorMemory.withdrawCollectedFees(tokens, amounts, treasury);
            emit FeesCollected(poolId, poolOwner, ownerAmount, treasury, treasuryAmount);
        }
    }

    function _computeAmounts(uint256 feeCollectorBptBalance, uint256 feePercentage)
        internal
        pure
        returns (uint256 ownerAmount, uint256 treasuryAmount)
    {
        ownerAmount = Math.divDown(Math.mul(feeCollectorBptBalance, feePercentage), 1e18);
        treasuryAmount = feeCollectorBptBalance.sub(ownerAmount);
    }

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return _getAuthorizer().canPerform(actionId, account, address(this));
    }

    function _getAuthorizer() internal view returns (IAuthorizer) {
        return protocolFeesCollector.getAuthorizer();
    }
}
