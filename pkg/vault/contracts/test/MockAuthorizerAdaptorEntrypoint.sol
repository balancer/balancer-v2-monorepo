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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptor.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

contract MockAuthorizerAdaptorEntrypoint {
    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function getAuthorizerAdaptor() external pure returns (IAuthorizerAdaptor) {
        return IAuthorizerAdaptor(0);
    }
}
