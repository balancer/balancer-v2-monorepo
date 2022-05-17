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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerMinter.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerTokenAdmin.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeController.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakelessGauge.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

abstract contract StakelessGauge is IStakelessGauge, ReentrancyGuard {
    IERC20 internal immutable _balToken;
    IBalancerTokenAdmin private immutable _tokenAdmin;
    IBalancerMinter private immutable _minter;
    IGaugeController private immutable _gaugeController;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;

    event Checkpoint(uint256 indexed periodTime, uint256 periodEmissions);

    // solhint-disable var-name-mixedcase
    uint256 private immutable _RATE_REDUCTION_TIME;
    uint256 private immutable _RATE_REDUCTION_COEFFICIENT;
    uint256 private immutable _RATE_DENOMINATOR;
    // solhint-enable var-name-mixedcase

    uint256 private _rate;
    uint256 private _period;
    uint256 private _startEpochTime;

    uint256 private _emissions;
    bool private _isKilled;

    constructor(IBalancerMinter minter) {
        IBalancerTokenAdmin tokenAdmin = IBalancerTokenAdmin(minter.getBalancerTokenAdmin());
        IERC20 balToken = tokenAdmin.getBalancerToken();
        IGaugeController gaugeController = minter.getGaugeController();

        _balToken = balToken;
        _tokenAdmin = tokenAdmin;
        _minter = minter;
        _gaugeController = gaugeController;
        _authorizerAdaptor = gaugeController.admin();

        _RATE_REDUCTION_TIME = tokenAdmin.RATE_REDUCTION_TIME();
        _RATE_REDUCTION_COEFFICIENT = tokenAdmin.RATE_REDUCTION_COEFFICIENT();
        _RATE_DENOMINATOR = tokenAdmin.RATE_DENOMINATOR();

        // Prevent initialisation of implementation contract
        // Choice of `type(uint256).max` prevents implementation from being checkpointed
        _period = type(uint256).max;
    }

    // solhint-disable-next-line func-name-mixedcase
    function __StakelessGauge_init() internal {
        require(_period == 0, "Already initialized");

        // Because we calculate the rate locally, this gauge cannot
        // be used prior to the start of the first emission period
        uint256 rate = _tokenAdmin.rate();
        require(rate != 0, "BalancerTokenAdmin not yet activated");

        _rate = rate;
        _period = _currentPeriod();
        _startEpochTime = _tokenAdmin.startEpochTimeWrite();
    }

    function checkpoint() external payable override nonReentrant returns (bool) {
        require(msg.sender == address(_authorizerAdaptor), "SENDER_NOT_ALLOWED");
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
                    // using the same formula as used in `BalancerTokenAdmin`. We perform the calculation
                    // locally instead of calling to `BalancerTokenAdmin.rate()` because we are generating
                    // the emissions for the upcoming week, so there is a possibility the new
                    // rate has not yet been applied.

                    // Calculate emission up until the epoch change
                    uint256 durationInCurrentEpoch = nextEpochTime - periodTime;
                    periodEmission = (gaugeWeight * rate * durationInCurrentEpoch) / 10**18;
                    // Action the decrease in rate
                    rate = (rate * _RATE_DENOMINATOR) / _RATE_REDUCTION_COEFFICIENT;
                    // Calculate emission from epoch change to end of period
                    uint256 durationInNewEpoch = 1 weeks - durationInCurrentEpoch;
                    periodEmission += (gaugeWeight * rate * durationInNewEpoch) / 10**18;

                    _rate = rate;
                    _startEpochTime = nextEpochTime;
                    nextEpochTime += _RATE_REDUCTION_TIME;
                } else {
                    periodEmission = (gaugeWeight * rate * 1 weeks) / 10**18;
                }

                emit Checkpoint(periodTime, periodEmission);
                newEmissions += periodEmission;
            }

            _period = currentPeriod;
            _emissions += newEmissions;

            if (newEmissions > 0 && !_isKilled) {
                _minter.mint(address(this));
                _postMintAction(newEmissions);
            }
        }

        return true;
    }

    function _currentPeriod() internal view returns (uint256) {
        // solhint-disable-next-line not-rely-on-time
        return (block.timestamp / 1 weeks) - 1;
    }

    function _postMintAction(uint256 mintAmount) internal virtual;

    // solhint-disable func-name-mixedcase

    function user_checkpoint(address) external pure override returns (bool) {
        return true;
    }

    function integrate_fraction(address user) external view override returns (uint256) {
        require(user == address(this), "Gauge can only mint for itself");
        return _emissions;
    }

    function is_killed() external view override returns (bool) {
        return _isKilled;
    }

    /**
     * @notice Kills the gauge so it cannot mint BAL
     */
    function killGauge() external override {
        require(msg.sender == address(_authorizerAdaptor), "SENDER_NOT_ALLOWED");
        _isKilled = true;
    }

    /**
     * @notice Unkills the gauge so it can mint BAL again
     */
    function unkillGauge() external override {
        require(msg.sender == address(_authorizerAdaptor), "SENDER_NOT_ALLOWED");
        _isKilled = false;
    }
}
