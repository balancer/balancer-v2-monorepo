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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./interfaces/IVeDelegation.sol";

contract VotingEscrowDelegationProxy is Authentication {
    IVault private immutable _vault;
    IERC20 private immutable _votingEscrow;
    IVeDelegation private _delegation;

    event DelegationImplementationUpdated(address indexed newImplementation);

    constructor(
        IVault vault,
        IERC20 votingEscrow,
        IVeDelegation delegation
    ) Authentication(bytes32(uint256(address(this)))) {
        // VotingEscrowDelegationProxy is a singleton,
        // so it simply uses its own address to disambiguate action identifiers
        _vault = vault;
        _votingEscrow = votingEscrow;
        _delegation = delegation;
    }

    /**
     * @notice Returns the current delegation implementation contract.
     */
    function getDelegationImplementation() external view returns (IVeDelegation) {
        return _delegation;
    }

    /**
     * @notice Returns the Voting Escrow (veBAL) contract.
     */
    function getVotingEscrow() external view returns (IERC20) {
        return _votingEscrow;
    }

    /**
     * @notice Returns the Balancer Vault.
     */
    function getVault() public view returns (IVault) {
        return _vault;
    }

    /**
     * @notice Returns the Balancer Vault's current authorizer.
     */
    function getAuthorizer() public view returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

    /**
     * @notice Get the adjusted veBAL balance from the active boost delegation contract
     * @param user The user to query the adjusted veBAL balance of
     * @return veBAL balance
     */
    function adjustedBalanceOf(address user) external view returns (uint256) {
        return _adjustedBalanceOf(user);
    }

    /**
     * @notice Get the adjusted veBAL balance from the active boost delegation contract
     * @param user The user to query the adjusted veBAL balance of
     * @return veBAL balance
     */
    function adjusted_balance_of(address user) external view returns (uint256) {
        return _adjustedBalanceOf(user);
    }

    // Internal functions

    function _adjustedBalanceOf(address user) internal view returns (uint256) {
        IVeDelegation implementation = _delegation;
        if (implementation == IVeDelegation(0)) {
            return IERC20(_votingEscrow).balanceOf(user);
        }
        return implementation.adjusted_balance_of(user);
    }

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return getAuthorizer().canPerform(actionId, account, address(this));
    }

    // Admin functions

    function setDelegation(IVeDelegation delegation) external authenticate {
        // call `adjusted_balance_of` to make sure it works
        delegation.adjusted_balance_of(msg.sender);

        _delegation = delegation;
        emit DelegationImplementationUpdated(address(delegation));
    }

    function killDelegation() external authenticate {
        _delegation = IVeDelegation(0);
        emit DelegationImplementationUpdated(address(0));
    }
}
