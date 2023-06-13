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

/**
 * @title IAvalancheBridgeLimitsProvider interface
 * @author Balancer Labs
 * @notice The Avalanche bridge (Multichain V4) sets both minimum and maximum limits on the number of tokens
 * that can be successfully bridged.
 * @dev See the Multichain Dapp UI <https://app.multichain.org/#/router> and select a chain and token to see
 * the current limits; they do not seem to be available anywhere on-chain. Exceeding these limits will *not*
 * cause the source chain transaction to revert - but it *will* irretrievably lock tokens in the AnySwap token
 * wrapper contract.
 *
 * These docs <https://medium.com/multichainorg/anyswap-fees-explained-bceddf535b83> say the limits are intended
 * to roughly correspond to a range of ~$10 to ~$5 million, but this is very approximate, and they do not seem to
 * have ever changed the limits from their starting values (there are permissioned functions to change them).
 *
 * To avoid loss of funds, the Avalance Root Gauge checks the amount to be bridged against these limits, and reverts
 * if they are exceeded.
 */
interface IAvalancheBridgeLimitsProvider {
    /**
     * @dev Getter for the Avalanche bridge limits.
     */
    function getAvalancheBridgeLimits() external view returns (uint256 minBridgeAmount, uint256 maxBridgeAmount);

    /**
     * @dev Setter for the Avalanche bridge limits. This is a permissioned function, as setting inappropriate limits
     * could either prevent distribution or cause loss of funds.
     */
    function setAvalancheBridgeLimits(uint256 minBridgeAmount, uint256 maxBridgeAmount) external;
}
