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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAuthorizer.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

/**
 * @dev Base authorization layer implementation for MultiDistributor
 */
abstract contract MultiDistributorAuthorization is Authentication {
    IVault private immutable _vault;

    /**
     * @dev Reverts unless `user` is the caller, or the caller is approved by the Authorizer to call the entry point
     * function (that is, it is a relayer for that function) and `user` approved the caller as a relayer
     * (via calling `setRelayerApproval` on the Vault)
     *
     * Should only be applied to external functions.
     */
    modifier authenticateFor(address user) {
        _authenticateFor(user);
        _;
    }

    constructor(IVault vault) Authentication(bytes32(uint256(address(this)))) {
        // MultiDistributor is a singleton, so it simply uses its own address to disambiguate action identifiers
        _vault = vault;
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    function _getAuthorizer() internal view returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return _getAuthorizer().canPerform(actionId, account, address(this));
    }

    /**
     * @dev Reverts unless `user` is the caller, or the caller is approved by the Authorizer to call the entry point
     * function (that is, it is a relayer for that function) and `user` approved the caller as a relayer
     * (via calling `setRelayerApproval` on the Vault)
     */
    function _authenticateFor(address user) internal view {
        if (msg.sender != user) {
            // In this context, 'permission to call a function' means 'being a relayer for a function'.
            _authenticateCaller();

            // Being a relayer is not sufficient: `user` must have also approved the caller via
            // calling `setRelayerApproval` on the Vault
            _require(getVault().hasApprovedRelayer(user, msg.sender), Errors.USER_DOESNT_ALLOW_RELAYER);
        }
    }
}
