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
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../lib/math/FixedPoint.sol";
import "../lib/helpers/ReentrancyGuard.sol";

import "./ProtocolFees.sol";
import "./VaultAuthorization.sol";
import "./interfaces/IVault.sol";

abstract contract Fees is IVault, ReentrancyGuard, VaultAuthorization {
    using SafeERC20 for IERC20;

    ProtocolFees private _protocolFees;

    constructor() {
        _protocolFees = new ProtocolFees(IVault(this));
    }

    function getProtocolFees() external view override returns (ProtocolFees) {
        return _protocolFees;
    }

    /**
     * @dev Returns the percentage protocol swap fee.
     */
    function _getProtocolSwapFee() internal view returns (uint256) {
        return _protocolFees.getSwapFee();
    }

    /**
     * @dev Returns the protocol fee to charge for a withdrawal of `amount`.
     */
    function _calculateWithdrawFee(uint256 amount) internal view returns (uint256) {
        return _calculateFee(amount, _protocolFees.getWithdrawFee());
    }

    /**
     * @dev Returns the protocol fee to charge for a flash loan of `amount`.
     */
    function _calculateFlashLoanFee(uint256 amount) internal view returns (uint256) {
        return _calculateFee(amount, _protocolFees.getFlashLoanFee());
    }

    function _calculateFee(uint256 amount, uint256 pct) internal pure returns (uint256) {
        // Fixed point multiplication introduces error: we round up, which means in certain scenarios the charged
        // percentage can be slightly higher than intended.
        return FixedPoint.mulUp(amount, pct);
    }

    function _payFee(IERC20 token, uint256 amount) internal {
        if (amount > 0) {
            token.safeTransfer(address(_protocolFees), amount);
        }
    }
}
