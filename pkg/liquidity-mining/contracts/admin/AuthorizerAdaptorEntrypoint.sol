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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptorEntrypoint.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IAuthorizer.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";

/**
 * @title Authorizer Adaptor Entrypoint
 * @notice This contract is intended to act as an entrypoint to perform actions via the authorizer adaptor, ensuring
 * actions are properly validated beforehand.
 *
 * @dev When calculating the actionId to call a function on a target contract, it must be calculated as if it were
 * to be called on the authorizer adaptor. This can be done by passing the function selector to the `getActionId`
 * function.
 */
contract AuthorizerAdaptorEntrypoint is IAuthorizerAdaptorEntrypoint {
    using Address for address;

    IAuthorizerAdaptor private immutable _adaptor;
    IVault private immutable _vault;

    constructor(IAuthorizerAdaptor adaptor) {
        _adaptor = adaptor;
        _vault = adaptor.getVault();
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

    /**
     * @notice Returns the Authorizer Adaptor
     */
    function getAuthorizerAdaptor() public view override returns (IAuthorizerAdaptor) {
        return _adaptor;
    }

    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return getAuthorizer().canPerform(actionId, account, where);
    }

    /**
     * @notice Returns the action ID associated with calling a given function through the authorizer adaptor.
     * @dev As the contracts managed by the adaptor don't have action ID disambiguators, we use the adaptor's globally.
     * This means that contracts with the same function selector will have a matching action ID:
     * if granularity is required then permissions must not be granted globally in the Authorizer.
     *
     * The adaptor entrypoint does not hold a disambiguator of its own; this function just forwards the call to the
     * adaptor itself.
     *
     * @param selector - The 4 byte selector of the function to be called using `performAction`
     * @return The associated action ID
     */
    function getActionId(bytes4 selector) public view override returns (bytes32) {
        return getAuthorizerAdaptor().getActionId(selector);
    }

    /**
     * @notice Performs an arbitrary function call on a target contract, provided the caller is authorized to do so.
     * @param target - Address of the contract to be called
     * @param data - Calldata to be sent to the target contract. It should be at least 4 bytes long (i.e. the length of
     * the selector corresponding to the function to be called)
     * @return The bytes encoded return value from the performed function call
     */
    function performAction(address target, bytes calldata data) external payable override returns (bytes memory) {
        // We want to check that the caller is authorized to call the function on the target rather than this function.
        // We must then pull the function selector from `data` rather than `msg.sig`.
        // Note that if `data` is less than 4 bytes long this will revert.
        bytes4 selector = data[0] | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24);

        // This call to `canPerform` will validate the actual action ID and sender in the authorizer.
        _require(canPerform(getActionId(selector), msg.sender, target), Errors.SENDER_NOT_ALLOWED);

        // Contracts using the adaptor expect it to be the caller of the actions to perform, so we forward
        // the call to `performAction` to the adaptor instead of performing it directly.
        return getAuthorizerAdaptor().performAction{ value: msg.value }(target, data);
    }
}
