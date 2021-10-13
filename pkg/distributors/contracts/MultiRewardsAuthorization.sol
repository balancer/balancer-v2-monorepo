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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20Permit.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAuthorizer.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IBasePool.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

/**
 * @dev Base authorization layer implementation for MultiRewards
 */
abstract contract MultiRewardsAuthorization is Authentication {
    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    modifier onlyAllowlisters(IERC20 pool) {
        require(
            _canPerform(getActionId(msg.sig), msg.sender) ||
                msg.sender == address(pool) ||
                isAssetManager(pool, msg.sender),
            "Only accessible by governance, pool or it's asset managers"
        );
        _;
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _getAuthorizer();
    }

    function _getAuthorizer() internal view returns (IAuthorizer) {
        // Access control management is delegated to the Vault's Authorizer. This lets Balancer Governance manage which
        // accounts can call permissioned functions: for example, to perform emergency pauses.
        return getVault().getAuthorizer();
    }

    /**
     * @notice Checks if a rewarder is an asset manager
     */
    function isAssetManager(IERC20 pool, address rewarder) public view returns (bool) {
        IBasePool poolContract = IBasePool(address(pool));
        bytes32 poolId = poolContract.getPoolId();
        (IERC20[] memory poolTokens, , ) = getVault().getPoolTokens(poolId);

        for (uint256 pt; pt < poolTokens.length; pt++) {
            (, , , address assetManager) = getVault().getPoolTokenInfo(poolId, poolTokens[pt]);
            if (assetManager == rewarder) {
                return true;
            }
        }
        return false;
    }

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return _getAuthorizer().canPerform(actionId, account, address(this));
    }
}
