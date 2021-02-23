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

import "../BasePoolFactory.sol";

import "./StablePool.sol";

contract StablePoolFactory is BasePoolFactory {
    constructor(IVault _vault) BasePoolFactory(_vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `StablePool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 amp,
        uint256 swapFee
    ) external returns (address) {
        address pool = address(new StablePool(vault, name, symbol, tokens, amp, swapFee));
        _register(pool);
        return pool;
    }
}
