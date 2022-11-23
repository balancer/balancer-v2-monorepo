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
 * @notice This contract exists as a fix for a critical bug in the `AuthorizerAdaptor` that could lead to escalation of
 * privileges. The Entrypoint contract addresses this by working in combination with `TimelockAuthorizer` so that all
 * Adaptor calls that are not made via the Entrypoint fail, while those that do happen through the Entrypoint check for
 * permissions correctly.
 */
contract AuthorizerAdaptorEntrypoint is IAuthorizerAdaptorEntrypoint {
    event ActionPerformed(bytes4 indexed selector, address indexed caller, address indexed target, bytes data);

    using Address for address;

    IAuthorizerAdaptor private immutable _adaptor;
    IVault private immutable _vault;

    constructor(IAuthorizerAdaptor adaptor) {
        _adaptor = adaptor;
        _vault = adaptor.getVault();
    }

    function getVault() public view override returns (IVault) {
        return _vault;
    }

    function getAuthorizer() public view override returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

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
     * @notice Returns the action ID associated with calling a given function through the `AuthorizerAdaptor`. Note that
     * even though the Adaptor's action IDs are not actually used by it (since the Authorizer ignores those values - see
     * `TimelockAuthorizer.canPerform`), this contract reuses those IDs to simplify migrations and tooling.
     *
     * See `AuthorizerAdaptor.getActionId` for more information on how the action IDs are computed, and how functions
     * with equal selectors are assigned the same action ID.
     */
    function getActionId(bytes4 selector) public view override returns (bytes32) {
        return getAuthorizerAdaptor().getActionId(selector);
    }

    function performAction(address target, bytes calldata data) external payable override returns (bytes memory) {
        // We want to check that the caller is authorized to call the function on the target rather than this function.
        // We must then pull the function selector from `data` rather than `msg.sig`.

        // Note that this will revert if `data` is less than 4 bytes long. We test for that to provide a nicer revert
        // reason.
        _require(data.length >= 4, Errors.INSUFFICIENT_DATA);
        bytes4 selector = data[0] | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24);

        _require(canPerform(getActionId(selector), msg.sender, target), Errors.SENDER_NOT_ALLOWED);

        emit ActionPerformed(selector, msg.sender, target, data);

        // The `AuthorizerAdaptor` will not check for permissions: it is special-cased in the `TimelockAuthorizer` so
        // that all calls to it that are not made from this entrypoint fail, while those that originate in the
        // entrypoint succeed. This works as we have just checked that the caller has permission to perform the action
        // encoded by `data`. See `TimelockAuthorizer.canPerform` for more details.
        return getAuthorizerAdaptor().performAction{ value: msg.value }(target, data);
    }
}
