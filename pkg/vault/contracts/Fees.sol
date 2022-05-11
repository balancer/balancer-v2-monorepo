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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./ProtocolFeesCollector.sol";
import "./VaultAuthorization.sol";

/**
 * @dev To reduce the bytecode size of the Vault, most of the protocol fee logic is not here, but in the
 * ProtocolFeesCollector contract.
 */
abstract contract Fees is IVault {
    using SafeERC20 for IERC20;

    ProtocolFeesCollector private immutable _protocolFeesCollector;

    constructor() {
        _protocolFeesCollector = new ProtocolFeesCollector(IVault(this));
    }

    function getProtocolFeesCollector() public view override returns (IProtocolFeesCollector) {
        return _protocolFeesCollector;
    }

    /**
     * @dev Returns the protocol swap fee percentage.
     */
    function _getProtocolSwapFeePercentage() internal view returns (uint256) {
        return getProtocolFeesCollector().getSwapFeePercentage();
    }

    /**
     * @dev Returns the protocol fee amount to charge for a flash loan of `amount`.
     */
    function _calculateFlashLoanFeeAmount(uint256 amount) internal view returns (uint256) {
        // Fixed point multiplication introduces error: we round up, which means in certain scenarios the charged
        // percentage can be slightly higher than intended.
        uint256 percentage = getProtocolFeesCollector().getFlashLoanFeePercentage();
        return FixedPoint.mulUp(amount, percentage);
    }

    function _payFeeAmount(IERC20 token, uint256 amount) internal {
        if (amount > 0) {
            token.safeTransfer(address(getProtocolFeesCollector()), amount);
        }
    }
}
