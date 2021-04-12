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

import "@balancer-labs/v2-core/contracts/vault/Vault.sol";
import "@balancer-labs/v2-core/contracts/vault/Authorizer.sol";
import "@balancer-labs/v2-core/contracts/pools/stable/StablePoolFactory.sol";
import "@balancer-labs/v2-core/contracts/pools/weighted/WeightedPoolFactory.sol";

import "@balancer-labs/v2-core/contracts/test/WETH.sol";
import "@balancer-labs/v2-core/contracts/test/MockFlashLoanReceiver.sol";

contract Imports {
    // solhint-disable-previous-line no-empty-blocks
}