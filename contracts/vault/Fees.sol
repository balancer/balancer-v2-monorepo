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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../lib/math/FixedPoint.sol";
import "../lib/helpers/ReentrancyGuard.sol";
import "../lib/helpers/BalancerErrors.sol";
import "../lib/openzeppelin/SafeERC20.sol";

import "./ProtocolFeesCollector.sol";
import "./VaultAuthorization.sol";
import "./interfaces/IVault.sol";

abstract contract Fees is IVault, ReentrancyGuard, VaultAuthorization {
    using SafeERC20 for IERC20;

    ProtocolFeesCollector private _protocolFeesCollector;

    constructor() {
        // Most of the protocol fee logic is not here but in the ProtocolFeesCollector contract. The reason for this is
        // to reduce the bytecode size of the Vault.
        _protocolFeesCollector = new ProtocolFeesCollector(IVault(this));
    }

    function getProtocolFeesCollector() external view override returns (ProtocolFeesCollector) {
        return _protocolFeesCollector;
    }

    /**
     * @dev Returns the percentage protocol swap fee.
     */
    function _getProtocolSwapFee() internal view returns (uint256) {
        return _protocolFeesCollector.getSwapFee();
    }

    /**
     * @dev Returns the protocol fee to charge for a withdrawal of `amount`.
     */
    function _calculateWithdrawFee(uint256 amount) internal view returns (uint256) {
        return _calculateFee(amount, _protocolFeesCollector.getWithdrawFee());
    }

    /**
     * @dev Returns the protocol fee to charge for a flash loan of `amount`.
     */
    function _calculateFlashLoanFee(uint256 amount) internal view returns (uint256) {
        return _calculateFee(amount, _protocolFeesCollector.getFlashLoanFee());
    }

    function _calculateFee(uint256 amount, uint256 pct) internal pure returns (uint256) {
        // Fixed point multiplication introduces error: we round up, which means in certain scenarios the charged
        // percentage can be slightly higher than intended.
        return FixedPoint.mulUp(amount, pct);
    }

    function _payFee(IERC20 token, uint256 amount) internal {
        if (amount > 0) {
            token.safeTransfer(address(_protocolFeesCollector), amount);
        }
    }
}
