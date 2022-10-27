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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerToken.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

/**
 * @dev This is an incomplete implementation of the token admin. It provides just enough functionality to be able to
 * instantiate Liquidity and Stakeless gauges.
 */
contract MockBalancerTokenAdmin {
    uint256 public constant INITIAL_RATE = (145000 * 1e18) / uint256(1 weeks); // BAL has 18 decimals
    uint256 public constant RATE_REDUCTION_TIME = 365 days;
    uint256 public constant RATE_REDUCTION_COEFFICIENT = 1189207115002721024; // 2 ** (1/4) * 1e18
    uint256 public constant RATE_DENOMINATOR = 1e18;

    IVault private _vault;
    IBalancerToken private _balancerToken;
    uint256 private _startEpochTime;
    uint256 private immutable _rate;

    constructor(IVault vault, IBalancerToken balancerToken) {
        _vault = vault;
        _balancerToken = balancerToken;
        // solhint-disable-next-line not-rely-on-time
        _startEpochTime = block.timestamp;
        _rate = INITIAL_RATE;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function getBalancerToken() external view returns (IBalancerToken) {
        return _balancerToken;
    }

    function startEpochTimeWrite() external returns (uint256) {
        return _epochWrite();
    }

    // solhint-disable func-name-mixedcase

    function future_epoch_time_write() external returns (uint256) {
        return _epochWrite();
    }

    function rate() external view returns (uint256) {
        return _rate;
    }

    function _epochWrite() internal returns (uint256) {
        _startEpochTime += 1;
        return _startEpochTime;
    }

    function mint(address to, uint256 amount) external {
        _balancerToken.mint(to, amount);
    }
}
