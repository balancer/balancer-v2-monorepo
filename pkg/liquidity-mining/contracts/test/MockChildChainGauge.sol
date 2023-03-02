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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IChildChainGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";

// solhint-disable func-name-mixedcase
contract MockChildChainGauge is IChildChainGauge {
    event UserCheckpoint(address user);

    using SafeMath for uint256;

    // solhint-disable-next-line var-name-mixedcase
    address public lp_token;
    ILiquidityGaugeFactory public override factory;
    string public override version;

    uint256 private _checkpointStep;
    mapping(address => uint256) private _integrateFraction;

    constructor(string memory _version) {
        version = _version;
    }

    function initialize(address pool, string memory _version) external override {
        lp_token = pool;
        factory = ILiquidityGaugeFactory(msg.sender);
        version = _version;
    }

    function setMockCheckpointStep(uint256 checkpointStep) external {
        _checkpointStep = checkpointStep;
    }

    function setMockFactory(ILiquidityGaugeFactory _factory) external {
        factory = _factory;
    }

    function integrate_fraction(address user) external view override returns (uint256) {
        return _integrateFraction[user];
    }

    function user_checkpoint(address user) external override returns (bool) {
        _integrateFraction[user] = _integrateFraction[user].add(_checkpointStep);
        emit UserCheckpoint(user);
        return true;
    }
}
