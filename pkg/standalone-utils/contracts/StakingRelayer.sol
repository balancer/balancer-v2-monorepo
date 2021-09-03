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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-distributors/contracts/interfaces/IMultiRewards.sol";

import "./relayer/RelayerAssetHelpers.sol";
import "./interfaces/IwstETH.sol";
import "./LidoRelayer.sol";

// solhint-disable max-line-length
/**
 * @title Lido Relayer
 * @dev This relayer allows users to use stETH on Balancer without needing to wrap separately.
 *      Users may atomically wrap stETH into wstETH (and vice versa) while performing
 *      swaps, joins and exits on the Vault.
 *
 *      The functions of this relayer are designed to match the interface of the underlying Vault equivalent.
 *      For more documentation, reference the Balancer Vault interface:
 *      https://github.com/balancer-labs/balancer-v2-monorepo/blob/vault-deployment/contracts/vault/interfaces/IVault.sol
 *
 */
contract StakingRelayer is LidoRelayer {
    IMultiRewards private immutable _stakingContract;

    constructor(
        IVault vault,
        IwstETH wstETH,
        IMultiRewards stakingContract
    ) LidoRelayer(vault, wstETH) {
        _stakingContract = stakingContract;
    }

    function getStakingContract() public view returns (IMultiRewards) {
        return _stakingContract;
    }

    function _getPoolAddress(bytes32 poolId) private pure returns (address) {
        return address(uint256(poolId) >> (12 * 8));
    }

    function joinAndStake(
        bytes32 poolId,
        address payable recipient,
        IVault.JoinPoolRequest calldata joinPoolRequest
    ) external {
        getVault().joinPool(poolId, msg.sender, address(this), joinPoolRequest);

        IERC20 bpt = IERC20(_getPoolAddress(poolId));
        uint256 bptAmount = bpt.balanceOf(address(this));

        //// If necessary, give staking contract allowance to take BPT
        if (bpt.allowance(address(this), address(getStakingContract())) < bptAmount) {
            bpt.approve(address(getStakingContract()), type(uint256).max);
        }

        getStakingContract().stakeFor(bpt, bptAmount, recipient);
    }
}
