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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerTokenAdmin.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeController.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IMainnetBalancerMinter.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";

import "./BalancerMinter.sol";

contract MainnetBalancerMinter is IMainnetBalancerMinter, BalancerMinter {
    using SafeMath for uint256;

    IBalancerTokenAdmin private immutable _tokenAdmin;
    IGaugeController private immutable _gaugeController;

    constructor(IBalancerTokenAdmin tokenAdmin, IGaugeController gaugeController)
        BalancerMinter(tokenAdmin.getBalancerToken(), "Balancer Minter", "1")
    {
        _tokenAdmin = tokenAdmin;
        _gaugeController = gaugeController;
    }

    /// @inheritdoc ILMGetters
    function getBalancerTokenAdmin() external view override returns (IBalancerTokenAdmin) {
        return _tokenAdmin;
    }

    /// @inheritdoc ILMGetters
    function getGaugeController() external view override returns (IGaugeController) {
        return _gaugeController;
    }

    // Internal functions

    function _mintFor(address gauge, address user) internal override returns (uint256 tokensToMint) {
        tokensToMint = _updateGauge(gauge, user);
        if (tokensToMint > 0) {
            _tokenAdmin.mint(user, tokensToMint);
        }
    }

    function _mintForMany(address[] calldata gauges, address user) internal override returns (uint256 tokensToMint) {
        uint256 length = gauges.length;
        for (uint256 i = 0; i < length; ++i) {
            tokensToMint = tokensToMint.add(_updateGauge(gauges[i], user));
        }

        if (tokensToMint > 0) {
            _tokenAdmin.mint(user, tokensToMint);
        }
    }

    function _updateGauge(address gauge, address user) internal returns (uint256 tokensToMint) {
        require(_gaugeController.gauge_types(gauge) >= 0, "Gauge does not exist on Controller");

        ILiquidityGauge(gauge).user_checkpoint(user);
        uint256 totalMint = ILiquidityGauge(gauge).integrate_fraction(user);
        tokensToMint = totalMint.sub(minted(user, gauge));

        if (tokensToMint > 0) {
            _setMinted(user, gauge, totalMint);
        }
    }
}
