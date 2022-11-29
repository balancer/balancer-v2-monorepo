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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeePercentagesProvider.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IFactoryCreatedPoolVersion.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolFactory.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";
import "@balancer-labs/v2-pool-utils/contracts/Version.sol";

import "./ManagedPool.sol";
import "../ExternalWeightedMath.sol";

/**
 * @dev This is a base factory designed to be called from other factories to deploy a ManagedPool
 * with a particular contract as the owner. This contract might have a privileged or admin account
 * to perform permissioned actions: this account is often called the pool manager.
 *
 * This factory should NOT be used directly to deploy ManagedPools owned by EOAs. ManagedPools
 * owned by EOAs would be very dangerous for LPs. There are no restrictions on what the owner
 * can do, so a malicious owner could easily manipulate prices and drain the pool.
 *
 * In this design, other client-specific factories will deploy a contract, then call this factory
 * to deploy the pool, passing in that contract address as the owner.
 */
contract ManagedPoolFactory is IFactoryCreatedPoolVersion, Version, BasePoolFactory, FactoryWidePauseWindow {
    IExternalWeightedMath private immutable _weightedMath;
    string private _poolVersion;

    constructor(
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        string memory factoryVersion,
        string memory poolVersion
    ) BasePoolFactory(vault, protocolFeeProvider, type(ManagedPool).creationCode) Version(factoryVersion) {
        _weightedMath = new ExternalWeightedMath();
        _poolVersion = poolVersion;
    }

    function getWeightedMath() external view returns (IExternalWeightedMath) {
        return _weightedMath;
    }

    function getPoolVersion() public view override returns (string memory) {
        return _poolVersion;
    }

    /**
     * @dev Deploys a new `ManagedPool`. The owner should be a contract, deployed by another factory.
     *
     * The pool version in the arguments will be overridden by the pool version stored at contract creation time.
     * The version is bundled in the parameters so as to prevent stack too deep errors.
     */
    function create(
        ManagedPoolSettings.NewPoolParams memory poolParams,
        address owner
    ) external returns (address pool) {
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();
        poolParams.version = getPoolVersion();

        return
            _create(
                abi.encode(
                    poolParams,
                    getVault(),
                    getProtocolFeePercentagesProvider(),
                    _weightedMath,
                    owner,
                    pauseWindowDuration,
                    bufferPeriodDuration
                )
            );
    }
}
