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

import "../PrimaryIssuePool.sol";

contract MockPrimaryIssuePool is PrimaryIssuePool {
    uint256 internal _wrappedTokenRate = 1e18;

    constructor(
        IVault vault,
        IERC20 security,
        IERC20 currency,
        uint256 minimumPrice,
        uint256 basePrice,
        uint256 maxSecurityOffered,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        uint256 issueCutoffTime,
        address owner
    )
        PrimaryIssuePool(
            vault,
            security,
            currency,
            minimumPrice,
            basePrice,
            maxSecurityOffered,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            issueCutoffTime,
            owner
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function setTotalSupply(uint256 value) external {
        _setTotalSupply(value);
    }

    function getScalingFactor(IERC20 token) external view returns (uint256) {
        return _scalingFactor(token);
    }

}
