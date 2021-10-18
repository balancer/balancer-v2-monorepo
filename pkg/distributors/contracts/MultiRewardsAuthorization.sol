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

    mapping(IERC20 => mapping(IERC20 => mapping(address => bool))) private _allowlist;

    event RewarderAllowlisted(address indexed stakingToken, address indexed rewardsToken, address indexed rewarder);

    constructor(IVault vault) {
        _vault = vault;
    }

    modifier onlyAllowlistedRewarder(IERC20 stakingToken, IERC20 rewardsToken) {
        require(
            _isAllowlistedRewarder(stakingToken, rewardsToken, msg.sender),
            "Only accessible by allowlisted rewarders"
        );
        _;
    }

    modifier onlyAllowlisters(IERC20 stakingToken) {
        require(
            _canPerform(getActionId(msg.sig), msg.sender) ||
                msg.sender == address(stakingToken) ||
                isAssetManager(stakingToken, msg.sender),
            "Only accessible by governance, staking token or asset managers"
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
     * @notice Allows a rewarder to be explicitly added to an allowlist of rewarders
     */
    function _allowlistRewarder(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        address rewarder
    ) internal {
        _allowlist[stakingToken][rewardsToken][rewarder] = true;
        emit RewarderAllowlisted(address(stakingToken), address(rewardsToken), rewarder);
    }

    function _isAllowlistedRewarder(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        address rewarder
    ) internal view returns (bool) {
        return _allowlist[stakingToken][rewardsToken][rewarder];
    }

    /**
     * @notice Checks if a rewarder is an asset manager
     */
    function isAssetManager(IERC20 stakingToken, address rewarder) public view returns (bool) {
        IBasePool pool = IBasePool(address(stakingToken));
        bytes32 poolId = pool.getPoolId();
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
