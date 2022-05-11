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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolSplitCodeFactory.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";

import "./UnbuttonAaveLinearPool.sol";

contract UnbuttonAaveLinearPoolFactory is BasePoolSplitCodeFactory, FactoryWidePauseWindow {
    constructor(IVault vault) BasePoolSplitCodeFactory(vault, type(UnbuttonAaveLinearPool).creationCode) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `UnbuttonAaveLinearPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IUnbuttonToken mainToken,
        IUnbuttonToken wrappedToken,
        uint256 upperTarget,
        uint256 swapFeePercentage,
        address owner
    ) external returns (LinearPool) {
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();

        LinearPool pool = UnbuttonAaveLinearPool(
            _create(
                abi.encode(
                    getVault(),
                    name,
                    symbol,
                    mainToken,
                    wrappedToken,
                    upperTarget,
                    swapFeePercentage,
                    pauseWindowDuration,
                    bufferPeriodDuration,
                    owner
                )
            )
        );

        // LinearPools have a separate post-construction initialization step: we perform it here to
        // ensure deployment and initialization are atomic.
        pool.initialize();

        return pool;
    }
}
