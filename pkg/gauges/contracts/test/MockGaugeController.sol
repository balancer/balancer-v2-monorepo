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

import "../interfaces/IGaugeController.sol";

contract MockGaugeController is IGaugeController {
    int128 private _numGaugeTypes;
    mapping(address => bool) private _validGauge;
    mapping(address => int128) private _gaugeType;

    event NewGauge(address addr, int128 gauge_type, uint256 weight);

    function n_gauge_types() external view override returns (int128) {
        return _numGaugeTypes;
    }

    function gauge_types(address gauge) external view override returns (int128) {
        require(_validGauge[gauge]);
        return _gaugeType[gauge];
    }

    function add_gauge(address gauge, int128 gaugeType) external override {
        require(!_validGauge[gauge]);
        require(gaugeType >= 0 && gaugeType < _numGaugeTypes);
        _validGauge[gauge] = true;
        emit NewGauge(gauge, gaugeType, 0);
    }

    function add_type(string calldata) external {
        _numGaugeTypes += 1;
    }
}
