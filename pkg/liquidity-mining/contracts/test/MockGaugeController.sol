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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeController.sol";

// For compatibility, we're keeping the same function names as in the original Curve code, including the mixed-case
// naming convention.
// solhint-disable func-name-mixedcase

contract MockGaugeController is IGaugeController {
    int128 private _numGaugeTypes;
    mapping(address => bool) private _validGauge;
    mapping(address => int128) private _gaugeType;

    IAuthorizerAdaptor public override admin;
    // solhint-disable-next-line var-name-mixedcase
    IVotingEscrow public override voting_escrow;

    // solhint-disable-next-line func-param-name-mixedcase, var-name-mixedcase
    event NewGauge(address addr, int128 gauge_type, uint256 weight);

    constructor(IVotingEscrow votingEscrow, IAuthorizerAdaptor authorizerAdaptor) {
        voting_escrow = votingEscrow;
        admin = authorizerAdaptor;
    }

    function n_gauge_types() external view override returns (int128) {
        return _numGaugeTypes;
    }

    function gauge_types(address gauge) external view override returns (int128) {
        require(_validGauge[gauge], "Gauge doesn't exist on controller");
        return _gaugeType[gauge];
    }

    function add_gauge(address gauge, int128 gaugeType) external override {
        require(!_validGauge[gauge], "Gauge already exists on controller");
        require(gaugeType >= 0 && gaugeType < _numGaugeTypes, "Invalid gauge type");
        _validGauge[gauge] = true;
        emit NewGauge(gauge, gaugeType, 0);
    }

    function add_type(string calldata, uint256) external override {
        _numGaugeTypes += 1;
    }

    function token() external pure override returns (IERC20) {
        return IERC20(0);
    }

    function checkpoint_gauge(address) external override {
        // solhint-disable-previous-line no-empty-blocks
    }

    function gauge_relative_weight(address, uint256) external view override returns (uint256) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function change_type_weight(int128, uint256) external override {
        // solhint-disable-previous-line no-empty-blocks
    }
}
