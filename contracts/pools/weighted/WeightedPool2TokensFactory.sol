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

import "../../vault/interfaces/IVault.sol";

import "../factories/BasePoolFactory.sol";
import "../factories/FactoryWidePauseWindow.sol";

import "./WeightedPool2Tokens.sol";

contract WeightedPool2TokensFactory is BasePoolFactory, FactoryWidePauseWindow {
    constructor(IVault vault) BasePoolFactory(vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `WeightedPool2Tokens`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFeePercentage,
        address owner
    ) external returns (address) {
        // TODO: Do not use arrays in the interface for tokens and weights
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();

        address pool = address(
            new WeightedPool2Tokens(
                getVault(),
                name,
                symbol,
                tokens[0],
                tokens[1],
                weights[0],
                weights[1],
                swapFeePercentage,
                pauseWindowDuration,
                bufferPeriodDuration,
                owner
            )
        );
        _register(pool);
        return pool;
    }
}
