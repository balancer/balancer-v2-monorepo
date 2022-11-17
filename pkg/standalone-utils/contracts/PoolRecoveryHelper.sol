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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IBasePoolFactory.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProviderPool.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRecoveryMode.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";

/**
 * @dev This contract allows anyone to check a given Pool's rate providers and put the Pool into recovery mode
 * if any are reverting on `getRate`. This allows LPs to exit promptly, and also helps off-chain mechanisms
 * identify failed pools and prevent further traffic from being routed to them (since in this state swap operations
 * would fail).
 */
contract PoolRecoveryHelper is SingletonAuthentication {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _factories;

    constructor(IVault vault, address[] memory initialFactories) SingletonAuthentication(vault) {
        for (uint256 i = 0; i < initialFactories.length; ++i) {
            require(_factories.add(initialFactories[i]), "Duplicate initial factory");
        }
    }

    /**
     * @notice Adds a Pool Factory to the helper. Only Pools created from factories added via this function can be
     * passed to `enableRecoveryMode()`.
     */
    function addPoolFactory(address factory) external authenticate {
        require(_factories.add(factory), "Duplicate factory");
    }

    /**
     * @notice Removes a Pool Factory from the helper.
     */
    function removePoolFactory(address factory) external authenticate {
        require(_factories.remove(factory), "Non-existent factory");
    }

    /**
     * @notice Returns the total number of Pool Factories.
     */
    function getFactoryCount() external view returns (uint256) {
        return _factories.length();
    }

    /**
     * @notice Returns the address of a Pool Factory at an index between 0 and the return value of `getFactoryCount()`.
     */
    function getFactoryAtIndex(uint256 index) external view returns (IBasePoolFactory) {
        return IBasePoolFactory(_factories.at(index));
    }

    /**
     * @notice Returns true if the Pool has been created from a known factory.
     */
    function isPoolFromKnownFactory(address pool) public view returns (bool) {
        uint256 totalFactories = _factories.length();
        for (uint256 i = 0; i < totalFactories; ++i) {
            IBasePoolFactory factory = IBasePoolFactory(_factories.unchecked_at(i));

            if (factory.isPoolFromFactory(pool)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @notice Enables Recovery Mode in a Pool, provided some of its rate providers are failing (i.e. `getRate()`
     * reverts).
     *
     * Pools that are in Recovery Mode can be exited by LPs via the special Recovery Mode Exit, which avoids any complex
     * computations and does not call into any external contracts, which makes it a very dependable way to retrieve the
     * underlying tokens.
     *
     * However, while Recovery Mode is enabled the Pool pays no protocol fees. Additionally, any protocol fees
     * accrued before enabling Recovery Mode will be forfeited.
     *
     * The Pool must have been created via a known Pool Factory contract.
     */
    function enableRecoveryMode(address pool) external {
        // We require that the Pools come from known factories as a sanity check since this function is permissionless.
        // This ensures we're actually calling legitimate Pools, and that they support both the IRateProviderPool and
        // IRecoveryMode interfaces.
        require(isPoolFromKnownFactory(pool), "Pool is not from known factory");

        // The Pool will be placed in recovery mode if any of its rate providers reverts.
        IRateProvider[] memory rateProviders = IRateProviderPool(pool).getRateProviders();
        for (uint256 i = 0; i < rateProviders.length; ++i) {
            if (rateProviders[i] != IRateProvider(0)) {
                try rateProviders[i].getRate()  {
                    // On success, we simply keep processing rate providers
                    continue;
                } catch {
                    IRecoveryMode(pool).enableRecoveryMode();
                    return;
                }
            }
        }

        // If no rate providers revert, we then revert to both signal that calling this function performs no state
        // changes, and to help prevent these accidental wasteful calls.
        revert("Pool's rate providers do not revert");
    }
}
