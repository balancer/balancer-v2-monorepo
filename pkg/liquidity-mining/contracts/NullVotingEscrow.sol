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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

/**
 * @title Null VotingEscrow
 * @notice This contract fulfils the role of a `VotingEscrow` contract
 * where no accounts hold a balance for the purposes of gauge boosts.
 * @dev This contract is to be used as the fallback `VotingEscrow` on chains other than Ethereum mainnet.
 * In the situation where boosts are not properly relayed from Ethereum mainnet to a chain and the veBoost
 * implementation is killed, values will be read from here which will have the effect of zeroing out any boosts.
 */
contract NullVotingEscrow is IERC20 {
    function totalSupply() external pure override returns (uint256) {
        return 0;
    }

    function balanceOf(address) external pure override returns (uint256) {
        return 0;
    }

    function allowance(address, address) external pure override returns (uint256) {
        return 0;
    }

    function approve(address, uint256) external pure override returns (bool) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function transfer(address, uint256) external pure override returns (bool) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function transferFrom(
        address,
        address,
        uint256
    ) external pure override returns (bool) {
        _revert(Errors.UNIMPLEMENTED);
    }
}
