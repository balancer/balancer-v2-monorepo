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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IChildChainLiquidityGaugeFactory.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Clones.sol";

contract ChildChainLiquidityGaugeFactory is IChildChainLiquidityGaugeFactory {
    // RewardsOnlyGauge expects the claim function selector to be left padded with zeros.
    // We then shift right 28 bytes so that the function selector (top 4 bytes) sits in the lowest 4 bytes.
    bytes32 private constant _CLAIM_SIG = keccak256("get_reward()") >> (28 * 8);

    ILiquidityGauge private immutable _gaugeImplementation;
    IChildChainStreamer private immutable _childChainStreamerImplementation;

    mapping(address => bool) private _isGaugeFromFactory;
    mapping(address => bool) private _isStreamerFromFactory;
    mapping(address => address) private _poolGauge;
    mapping(address => address) private _gaugeStreamer;

    constructor(ILiquidityGauge gauge, IChildChainStreamer childChainStreamer) {
        _gaugeImplementation = gauge;
        _childChainStreamerImplementation = childChainStreamer;
    }

    /**
     * @notice Returns the address of the implementation used for gauge deployments.
     */
    function getGaugeImplementation() external view override returns (ILiquidityGauge) {
        return _gaugeImplementation;
    }

    /**
     * @notice Returns the address of the implementation used for streamer deployments.
     */
    function getChildChainStreamerImplementation() external view override returns (IChildChainStreamer) {
        return _childChainStreamerImplementation;
    }

    /**
     * @notice Returns the address of the gauge belonging to `pool`.
     */
    function getPoolGauge(address pool) public view override returns (ILiquidityGauge) {
        return ILiquidityGauge(_poolGauge[pool]);
    }

    /**
     * @notice Returns true if `gauge` was created by this factory.
     */
    function isGaugeFromFactory(address gauge) external view override returns (bool) {
        return _isGaugeFromFactory[gauge];
    }

    /**
     * @notice Returns the address of the streamer belonging to `gauge`.
     */
    function getGaugeStreamer(address gauge) public view override returns (address) {
        return _gaugeStreamer[gauge];
    }

    /**
     * @notice Returns true if `streamer` was created by this factory.
     */
    function isStreamerFromFactory(address streamer) external view override returns (bool) {
        return _isStreamerFromFactory[streamer];
    }

    /**
     * @notice Returns the address of the pool which `gauge` belongs.
     */
    function getGaugePool(address gauge) external view override returns (IERC20) {
        return IRewardsOnlyGauge(gauge).lp_token();
    }

    /**
     * @notice Returns the address of the streamer belonging to `pool`'s gauge.
     */
    function getPoolStreamer(address pool) external view override returns (address) {
        return getGaugeStreamer(address(getPoolGauge(pool)));
    }

    /**
     * @notice Deploys a new gauge for a Balancer pool.
     * @dev As anyone can register arbitrary Balancer pools with the Vault,
     * it's impossible to prove onchain that `pool` is a "valid" deployment.
     *
     * Care must be taken to ensure that gauges deployed from this factory are
     * suitable before they are added to the GaugeController.
     *
     * This factory disallows deploying multiple gauges for a single pool.
     * @param pool The address of the pool for which to deploy a gauge
     * @return The address of the deployed gauge
     */
    function create(address pool) external override returns (address) {
        require(_poolGauge[pool] == address(0), "Gauge already exists");

        address gauge = Clones.clone(address(_gaugeImplementation));
        address streamer = Clones.clone(address(_childChainStreamerImplementation));

        IChildChainStreamer(streamer).initialize(gauge);
        IRewardsOnlyGauge(gauge).initialize(pool, streamer, _CLAIM_SIG);

        _isGaugeFromFactory[gauge] = true;
        _poolGauge[pool] = gauge;
        _gaugeStreamer[gauge] = streamer;
        emit RewardsOnlyGaugeCreated(gauge, pool, streamer);

        return gauge;
    }
}
