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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../vault/IVault.sol";

abstract contract BasePoolFactory {
    using Address for address;

    IVault public immutable vault;

    event PoolCreated(address indexed pool);

    constructor(IVault _vault) {
        vault = _vault;
    }

    /**
     * @dev Deploys a pool contract defined by `creationCode`. The `salt` value is only used in determining the
     * resulting pool address. Any value can be passed, but reusing `salt` for a given `creationCode` results in
     * a revert.
     *
     * Before the constructor of the created contract is executed, the factory will register it in the Vault as a
     * Universal Agent. This means the contract will be able to pull funds from both User Balance and tokens that have
     * been granted allowance. As is always the case when dealing with Universal Agents, the contract should be careful
     * to authenticate any addresses they use this way.
     *
     * The creation code for a Solidity contract can be constructed by concatenating the `creationCode` property of the
     * contract type with the ABI-encoded constructor arguments. Note that the compiler doesn't perform any type
     * checking here: all factory-created contracts should be subject to at least basic testing.
     *
     * Sample usage using abi.encodePacked to concatenate the `bytes` arrays:
     *   _create(abi.encodePacked(type(ERC20).creationCode, abi.encode("My Token", "TKN", 18)), salt);
     *
     * Emits a `PoolCreated` event.
     *
     * Returns the address of the created contract.
     */
    function _create(bytes memory creationCode, bytes32 salt) internal returns (address) {
        // TODO: consider internally choosing a salt value (e.g. an incrementing counter hash with the blockchash) to
        // disallow vanity pool addresses (which might cause phishing issues). This might not make sense because other
        // arguments could still be changed sligthly to act as a nonce.

        address expectedPool = Create2.computeAddress(salt, keccak256(creationCode));
        require(!expectedPool.isContract(), "Salt cannot be reused");

        vault.addUniversalAgent(expectedPool);

        address pool = Create2.deploy(0, salt, creationCode);
        assert(pool == expectedPool);

        emit PoolCreated(pool);

        return pool;
    }
}
