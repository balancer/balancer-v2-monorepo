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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolSplitCodeFactory.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";

import "./NoProtocolFeeLiquidityBootstrappingPool.sol";

contract NoProtocolFeeLiquidityBootstrappingPoolFactory is
    Authentication,
    BasePoolSplitCodeFactory,
    FactoryWidePauseWindow
{
    bool private _disabled;

    event FactoryDisabled();

    constructor(IVault vault)
        // This factory is a singleton, so it simply uses its own address to disambiguate action identifiers.
        Authentication(bytes32(uint256(address(this))))
        BasePoolSplitCodeFactory(vault, type(NoProtocolFeeLiquidityBootstrappingPool).creationCode)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function isDisabled() public view returns (bool) {
        return _disabled;
    }

    function disable() external authenticate {
        _disabled = true;
        emit FactoryDisabled();
    }

    /**
     * @dev Deploys a new `NoProtocolFeeLiquidityBootstrappingPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFeePercentage,
        address owner,
        bool swapEnabledOnStart
    ) external returns (address) {
        _require(!_disabled, Errors.DISABLED);

        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();

        return
            _create(
                abi.encode(
                    getVault(),
                    name,
                    symbol,
                    tokens,
                    weights,
                    swapFeePercentage,
                    pauseWindowDuration,
                    bufferPeriodDuration,
                    owner,
                    swapEnabledOnStart
                )
            );
    }

    function _canPerform(bytes32 actionId, address user) internal view override returns (bool) {
        return (getVault().getAuthorizer().canPerform(actionId, user, address(this)));
    }
}
