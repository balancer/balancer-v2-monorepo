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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "../interfaces/IBalancerMinter.sol";
import "../interfaces/IBalancerTokenAdmin.sol";
import "../interfaces/IGaugeController.sol";
import "../interfaces/ILiquidityGauge.sol";

abstract contract PremintedGauge is ILiquidityGauge, ReentrancyGuard {
    IERC20 internal immutable _balToken;
    IBalancerTokenAdmin private immutable _tokenAdmin;
    IBalancerMinter private immutable _minter;
    IGaugeController private immutable _gaugeController;

    // TODO: pull these from BalancerTokenAdmin instead of duplicating definitions
    uint256 private constant _INITIAL_RATE = 32165468432186542;
    uint256 private constant _RATE_REDUCTION_TIME = 365 days;
    uint256 private constant _RATE_REDUCTION_COEFFICIENT = 1189207115002721024; // 2 ** (1/4) * 1e18
    uint256 private constant _RATE_DENOMINATOR = 1e18;

    uint256 private _rate;
    uint256 private _period;
    uint256 private _startEpochTime;

    uint256 private _emissions;
    bool public isKilled;

    constructor(IBalancerMinter minter) {
        IBalancerTokenAdmin tokenAdmin = IBalancerTokenAdmin(minter.getBalancerTokenAdmin());
        IERC20 balToken = tokenAdmin.getBalancerToken();

        _balToken = balToken;
        _tokenAdmin = tokenAdmin;
        _minter = minter;
        _gaugeController = minter.getGaugeController();

        // Because we calculate the rate locally, this gauge cannot
        // be used prior to the start of the first emission period
        uint256 rate = tokenAdmin.rate();
        require(rate != 0);

        _rate = rate;
        _period = _currentPeriod();
        _startEpochTime = tokenAdmin.startEpochTimeWrite();
    }

    function checkpoint() external nonReentrant returns (bool) {
        // TODO: Add a guard to checkpointing.
        uint256 lastPeriod = _period;
        uint256 currentPeriod = _currentPeriod();

        if (lastPeriod < currentPeriod) {
            _gaugeController.checkpoint_gauge(address(this));

            uint256 rate = _rate;
            uint256 newEmissions = 0;
            lastPeriod += 1;
            uint256 nextEpochTime = _startEpochTime + _RATE_REDUCTION_TIME;
            for (uint256 i = lastPeriod; i < lastPeriod + 255; ++i) {
                if (i > currentPeriod) break;

                uint256 periodTime = i * 1 weeks;
                uint256 periodEmission = 0;
                uint256 gaugeWeight = _gaugeController.gauge_relative_weight(address(this), periodTime);

                if (nextEpochTime >= periodTime && nextEpochTime < periodTime + 1 weeks) {
                    // If the period crosses an epoch, we calculate a reduction in the rate
                    // using the same formula as used in `ERC20CRV`. We perform the calculation
                    // locally instead of calling to `ERC20CRV.rate()` because we are generating
                    // the emissions for the upcoming week, so there is a possibility the new
                    // rate has not yet been applied.

                    // Calculate emission up until the epoch change
                    periodEmission = (gaugeWeight * rate * (nextEpochTime - periodTime)) / 10**18;
                    // Action the decrease in rate
                    rate = (rate * _RATE_DENOMINATOR) / _RATE_REDUCTION_COEFFICIENT;
                    // Calculate emission from epoch change to end of period
                    periodEmission += (gaugeWeight * rate * (periodTime + 1 weeks - nextEpochTime)) / 10**18;

                    _rate = rate;
                    _startEpochTime = nextEpochTime;
                    nextEpochTime += _RATE_REDUCTION_TIME;
                } else {
                    periodEmission = (gaugeWeight * rate * 1 weeks) / 10**18;
                }

                //log PeriodEmission(period_time, period_emission)
                newEmissions += periodEmission;
            }

            _period = currentPeriod;
            _emissions += newEmissions;

            if (newEmissions > 0 && !isKilled) {
                _minter.mint(address(this));
                _postMintAction(newEmissions);
            }
        }

        return true;
    }

    function _currentPeriod() internal view returns (uint256) {
        return (block.timestamp / 1 weeks) - 1;
    }

    function _postMintAction(uint256 mintAmount) internal virtual;

    function user_checkpoint(address) external pure override returns (bool) {
        return true;
    }

    function integrate_fraction(address user) external view override returns (uint256) {
        require(user == address(this), "Gauge can only mint for itself");
        return _emissions;
    }
}
