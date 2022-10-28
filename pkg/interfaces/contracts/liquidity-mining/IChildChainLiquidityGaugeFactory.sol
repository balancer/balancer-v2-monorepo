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

pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "./IChildChainStreamer.sol";
import "./ILiquidityGauge.sol";
import "./ILiquidityGaugeFactory.sol";
import "./IRewardsOnlyGauge.sol";

interface IChildChainLiquidityGaugeFactory is ILiquidityGaugeFactory {
    event RewardsOnlyGaugeCreated(address indexed gauge, address indexed pool, address streamer);

    /**
     * @notice Returns the address of the implementation used for gauge deployments.
     */
    function getGaugeImplementation() external view returns (ILiquidityGauge);

    /**
     * @notice Returns the address of the implementation used for streamer deployments.
     */
    function getChildChainStreamerImplementation() external view returns (IChildChainStreamer);

    /**
     * @notice Returns the address of the gauge belonging to `pool`.
     */
    function getPoolGauge(address pool) external view returns (ILiquidityGauge);

    /**
     * @notice Returns the address of the streamer belonging to `gauge`.
     */
    function getGaugeStreamer(address gauge) external view returns (address);

    /**
     * @notice Returns true if `streamer` was created by this factory.
     */
    function isStreamerFromFactory(address streamer) external view returns (bool);

    /**
     * @notice Returns the address of the pool which `gauge` belongs.
     */
    function getGaugePool(address gauge) external view returns (IERC20);

    /**
     * @notice Returns the address of the streamer belonging to `pool`'s gauge.
     */
    function getPoolStreamer(address pool) external view returns (address);
}
