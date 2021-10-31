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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";

import "../BasePoolAuthorization.sol";
import "../interfaces/IBasePoolController.sol";
import "../interfaces/IControlledPool.sol";

/**
 * @dev Pool controller that serves as the "owner" of a Balancer pool, and is in turn owned by
 * an account empowered to make calls on this contract that are forwarded to the underlyling pool.
 *
 * While Balancer pool owners are immutable, ownership of this pool controller is transferrable.
 * The deployer will be the initial owner
 */
contract BasePoolController is IBasePoolController, Ownable {
    address public pool;

    // Modifiers

    modifier withBoundPool {
        _ensurePoolIsBound();
        _;
    }

    // External functions

    /**
     * @dev The pool needs this controller's address (as its owner), and this controller also needs the
     * pool's address to delegate the calls.
     */
    function bindPool(address poolAddress) external virtual override {
        _require(
            pool == address(0) && BasePoolAuthorization(poolAddress).getOwner() == address(this),
            Errors.INVALID_INITIALIZATION
        );

        pool = poolAddress;
    }

    function setSwapFeePercentage(uint256 swapFeePercentage) external virtual override onlyOwner withBoundPool {
        IControlledPool(pool).setSwapFeePercentage(swapFeePercentage);
    }

    function setAssetManagerPoolConfig(IERC20 token, bytes memory poolConfig)
        external
        virtual
        override
        onlyOwner
        withBoundPool
    {
        IControlledPool(pool).setAssetManagerPoolConfig(token, poolConfig);
    }

    function _ensurePoolIsBound() private view {
        _require(pool != address(0), Errors.UNINITIALIZED);
    }
}
