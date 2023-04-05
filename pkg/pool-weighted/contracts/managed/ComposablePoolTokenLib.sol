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

import "@balancer-labs/v2-interfaces/contracts/pool-weighted/IComposablePoolTokenLib.sol";

import "./ManagedPool.sol";

contract ComposablePoolTokenLib is IComposablePoolTokenLib {
    IVault private immutable _vault;
    bytes32 private immutable _poolId;

    constructor(ManagedPool pool) {
        _vault = pool.getVault();
        _poolId = pool.getPoolId();
    }

    function getPoolTokens() external view override returns (IERC20[] memory, uint256[] memory) {
        (IERC20[] memory registeredTokens, uint256[] memory registeredBalances, ) = _vault.getPoolTokens(_poolId);

        return ComposablePoolLib.dropBpt(registeredTokens, registeredBalances);
    }
}