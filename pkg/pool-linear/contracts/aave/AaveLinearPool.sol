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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IStaticAToken.sol";

import "../LinearPool.sol";

contract AaveLinearPool is LinearPool {
    ILendingPool private immutable _lendingPool;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20 mainToken,
        IERC20 wrappedToken,
        uint256 upperTarget,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        LinearPool(
            vault,
            name,
            symbol,
            mainToken,
            wrappedToken,
            upperTarget,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _lendingPool = IStaticAToken(address(wrappedToken)).LENDING_POOL();
        _require(address(mainToken) == IStaticAToken(address(wrappedToken)).ASSET(), Errors.TOKENS_MISMATCH);
    }

    function _getWrappedTokenRate() internal view override returns (uint256) {
        // This pulls in the implementation of `rate` used in the StaticAToken contract
        // except avoiding storing relevant variables in storage for gas reasons.
        // solhint-disable-next-line max-line-length
        // see: https://github.com/aave/protocol-v2/blob/ac58fea62bb8afee23f66197e8bce6d79ecda292/contracts/protocol/tokenization/StaticATokenLM.sol#L255-L257
        uint256 rate = _lendingPool.getReserveNormalizedIncome(address(getMainToken()));

        // This function returns a 18 decimal fixed point number, but `rate` has 27 decimals (i.e. a 'ray' value)
        // so we need to convert it.
        return rate / 10**9;
    }
}
