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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IVersionProvider.sol";

/**
 * @notice Retrieves a contract's version using the given provider.
 *
 * @dev The contract happens to have the same interface as the version provider, but it only holds a reference
 * to the version provider to be more efficient in terms of deployed bytecode size.
 */
contract Version is IVersionProvider {
    IVersionProvider private immutable _versionProvider;

    constructor(IVersionProvider versionProvider) {
        _versionProvider = versionProvider;
    }

    function version() external view override returns (string memory) {
        return _versionProvider.version();
    }
}
