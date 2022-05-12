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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

// solhint-disable not-rely-on-time

/**
 * @dev The currently deployed Authorizer has a different interface relative to the Authorizer in the monorepo
 * for granting/revoking roles(referred to as permissions in the new Authorizer) and so we require a one-off interface
 */
interface ICurrentAuthorizer is IAuthorizer {
    // solhint-disable-next-line func-name-mixedcase
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);

    function grantRole(bytes32 role, address account) external;

    function revokeRole(bytes32 role, address account) external;
}

abstract contract BaseCoordinator is ReentrancyGuard {
    IVault private immutable _vault;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;

    uint256 private _currentStage;
    uint256 private immutable _lastStage;

    uint256[] private _stageActivationTime;

    constructor(IAuthorizerAdaptor authorizerAdaptor, uint256 lastStage) {
        _currentStage = 0;
        _lastStage = lastStage;
        _stageActivationTime = new uint256[](lastStage + 1);

        IVault vault = authorizerAdaptor.getVault();
        _vault = vault;
        _authorizerAdaptor = authorizerAdaptor;
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
    function getAuthorizer() public view returns (ICurrentAuthorizer) {
        return ICurrentAuthorizer(address(getVault().getAuthorizer()));
    }

    function getAuthorizerAdaptor() public view returns (IAuthorizerAdaptor) {
        return _authorizerAdaptor;
    }

    function getCurrentStage() external view returns (uint256) {
        return _currentStage;
    }

    function getStageActivationTime(uint256 stage) public view returns (uint256) {
        return _stageActivationTime[stage];
    }

    function performNextStage() external nonReentrant {
        uint256 currentStage = _currentStage;
        _checkReadyFixed(currentStage);

        _performNextStage(currentStage);

        _advanceCurrentStage(currentStage);
    }

    function _getTimeSinceLastStageActivation() internal view returns (uint256) {
        return block.timestamp - getStageActivationTime(_currentStage - 1);
    }

    function _checkReadyFixed(uint256 currentStage) internal view {
        // Check external state: we need admin permission on the Authorizer.
        require(getAuthorizer().canPerform(bytes32(0), address(this), address(0)), "Not Authorizer admin");

        // Check internal state: don't allow progressing coordinator past final stage.
        require(currentStage <= _lastStage, "Coordinator has been fully processed");

        _checkReady(currentStage);
    }

    function _checkReady(uint256) internal view virtual {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _performNextStage(uint256 currentStage) internal virtual;

    function _advanceCurrentStage(uint256 currentStage) internal {
        _stageActivationTime[currentStage] = block.timestamp;
        _currentStage = currentStage + 1;

        if (currentStage == _lastStage) {
            _cleanupFixed();
        }
    }

    function _cleanupFixed() internal virtual {
        getAuthorizer().revokeRole(bytes32(0), address(this));
        _cleanup();
    }

    function _cleanup() internal view virtual {
        // solhint-disable-previous-line no-empty-blocks
    }
}
