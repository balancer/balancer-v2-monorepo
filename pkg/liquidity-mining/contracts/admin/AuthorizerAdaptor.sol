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
import "@balancer-labs/v2-interfaces/contracts/vault/IAuthorizer.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";

/**
 * @title Authorizer Adaptor
 * @notice This contract is intended to act as an adaptor between systems which expect a single admin address
 * and the Balancer Authorizer such that the Authorizer may grant/revoke admin powers to unlimited addresses.
 *
 * The permissions the Authorizer can grant are granular such they may be global or specific to a particular contract
 *
 * @dev When calculating the actionId to call a function on a target contract, it must be calculated as if it were
 * to be called on this adaptor. This can be done by passing the function selector to the `getActionId` function.
 */
contract AuthorizerAdaptor is IAuthorizerAdaptor, ReentrancyGuard {
    using Address for address;

    bytes32 private immutable _actionIdDisambiguator;
    IVault private immutable _vault;

    constructor(IVault vault) {
        // AuthorizerAdaptor is a singleton, so it simply uses its own address to disambiguate action identifiers
        _actionIdDisambiguator = bytes32(uint256(address(this)));
        _vault = vault;
    }

    /**
     * @notice Returns the Balancer Vault
     */
    function getVault() public view override returns (IVault) {
        return _vault;
    }

    /**
     * @notice Returns the Authorizer
     */
    function getAuthorizer() public view override returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

    function _canPerform(
        bytes32 actionId,
        address account,
        address where
    ) internal view returns (bool) {
        return getAuthorizer().canPerform(actionId, account, where);
    }

    /**
     * @notice Returns the action ID associated with calling a given function through this adaptor
     * @dev As the contracts managed by this adaptor don't have action ID disambiguators, we use the adaptor's globally.
     * This means that contracts with the same function selector will have a matching action ID:
     * if granularity is required then permissions must not be granted globally in the Authorizer.
     *
     * @param selector - The 4 byte selector of the function to be called using `performAction`
     * @return The associated action ID
     */
    function getActionId(bytes4 selector) public view override returns (bytes32) {
        return keccak256(abi.encodePacked(_actionIdDisambiguator, selector));
    }

    /**
     * @notice Performs an arbitrary function call on a target contract, provided the caller is authorized to do so.
     * @param target - Address of the contract to be called
     * @param data - Calldata to be sent to the target contract
     * @return The bytes encoded return value from the performed function call
     */
    function performAction(address target, bytes calldata data)
        external
        payable
        override
        nonReentrant
        returns (bytes memory)
    {
        bytes4 selector;

        // We want to check that the caller is authorized to call the function on the target rather than this function.
        // We must then pull the function selector from `data` rather than `msg.sig`. The most effective way to do this
        // is via assembly.
        // Note that if `data` is empty this will return an empty function signature (0x00000000)

        // solhint-disable-next-line no-inline-assembly
        assembly {
            // The function selector encoded in `data` has an offset relative to the start of msg.data of:
            // - 4 bytes due to the function selector for `performAction`
            // - 3 words (3 * 32 = 96 bytes) for `target` and the length and offset of `data`
            // 96 + 4 = 100 bytes
            selector := calldataload(100)
        }

        _require(_canPerform(getActionId(selector), msg.sender, target), Errors.SENDER_NOT_ALLOWED);

        // We don't check that `target` is a contract so all calls to an EOA will succeed.
        return target.functionCallWithValue(data, msg.value);
    }
}
