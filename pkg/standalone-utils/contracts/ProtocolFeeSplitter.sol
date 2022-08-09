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

// TODO: this interface is stupid
interface Pool {
    function getOwner() external returns (address);
}

/**
 * @dev TODO: this
 */
contract ProtocolFeeSplitter is IProtocolFeeSplitter, Authentication {
    using Math for uint256;

    event FeesCollected(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 ownerEarned,
        address indexed treasury,
        uint256 treasuryEarned
    );

    IProtocolFeesCollector public immutable protocolFeesCollector;

    // TODO: pull form somewhere else? constant? immutable?
    address public treasury;

    // Absolute maximum fee percentages (1e18 = 100%, 1e16 = 1%).
    uint256 private constant _MAX_REVENUE_SHARING_FEE_PERCENTAGE = 50e16; // 50%
    uint256 private constant _DEFAULT_REVENUE_SHARE = 10e16; // 10%

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
        _require(newSwapFeePercentage <= _MAX_REVENUE_SHARING_FEE_PERCENTAGE, Errors.SPLITTER_FEE_PERCENTAGE_TOO_HIGH);
        revenueSharePerPool[poolId] = newSwapFeePercentage;
        emit PoolRevenueShareChanged(poolId, newSwapFeePercentage);
    }

    function collectFees(bytes32 poolId) external override {
        address pool = VaultHelpers.toPoolAddress(poolId);
        IERC20 bpt = IERC20(pool);

        IProtocolFeesCollector protocolFeesCollectorMemory = protocolFeesCollector;
        uint256 feeCollectorBptBalance = bpt.balanceOf(address(protocolFeesCollectorMemory));
        if (feeCollectorBptBalance == 0) {
            _revert(Errors.NO_BPT_FEES_COLLECTED);
        }

        // withdrawCollectedFees requires array of tokens, and we are only transfering one token
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = bpt;

        address treasuryMemory = treasury;
        address poolOwner = Pool(pool).getOwner();

        // If the pool has no owner/delegated owner transfer everything to tresury
        if (poolOwner == address(0) || poolOwner == 0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B) {
            uint256[] memory amounts = new uint256[](1);
            amounts[0] = feeCollectorBptBalance;
            protocolFeesCollectorMemory.withdrawCollectedFees(tokens, amounts, treasuryMemory);
            emit FeesCollected(poolId, poolOwner, 0, treasuryMemory, feeCollectorBptBalance);
        } else {
            // TODO: check what is cheaper gas-wise
            // transfer to this contract with protocolFeesCollector.withdrawCollectedFees
            // and then transfer to owner , treasury
            // or call 2x protocolFeesCollector.withdrawCollectedFees (current version)

            // TODO: what if the owner is a smart contract and can't handle erc20 tokens
            // withdrawCollectedFees reverts?
            // funds remain in feeCollector and manual work is required to transfer them to treasury?

            (uint256 ownerAmount, uint256 treasuryAmount) = _calculateAmounts(poolId, feeCollectorBptBalance);

            uint256[] memory amounts = new uint256[](1);
            amounts[0] = ownerAmount;

            // withdraw to owner
            protocolFeesCollectorMemory.withdrawCollectedFees(tokens, amounts, poolOwner);
            // update amount to treasuryAmount
            amounts[0] = treasuryAmount;
            // withdraw to treasury
            protocolFeesCollectorMemory.withdrawCollectedFees(tokens, amounts, treasuryMemory);
            emit FeesCollected(poolId, poolOwner, ownerAmount, treasuryMemory, treasuryAmount);
        }
    }

    function _calculateAmounts(bytes32 poolId, uint256 feeCollectorBptBalance)
        internal
        view
        returns (uint256 ownerAmount, uint256 treasuryAmount)
    {
        // Check if that pool has an override
        uint256 revenueShareOverride = revenueSharePerPool[poolId];
        uint256 swapFeePercentage = revenueShareOverride > 0 ? revenueShareOverride : _DEFAULT_REVENUE_SHARE;
        ownerAmount = Math.divDown(Math.mul(feeCollectorBptBalance, swapFeePercentage), 1e18);
        treasuryAmount = feeCollectorBptBalance.sub(ownerAmount);
    }

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return _getAuthorizer().canPerform(actionId, account, address(this));
    }

    function _getAuthorizer() internal view returns (IAuthorizer) {
        return protocolFeesCollector.getAuthorizer();
    }
}
