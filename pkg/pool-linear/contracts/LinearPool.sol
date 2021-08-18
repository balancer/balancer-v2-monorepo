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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-utils/contracts/interfaces/IRateProvider.sol";
import "@balancer-labs/v2-pool-utils/contracts/BaseMinimalSwapInfoPool.sol";

import "./LinearMath.sol";

/**
 * @dev LinearPool suitable for assets with an equal underlying token with an exact and non-manipulable exchange rate.
 * Requires an external feed of these exchange rates.
 */
contract LinearPool is BaseMinimalSwapInfoPool, LinearMath, IRateProvider {
    uint256 private constant _TOTAL_TOKENS = 3; //Main token, wrapped token, BPT

    IVault private immutable _vault;

    IERC20 internal immutable _mainToken;
    IERC20 internal immutable _wrappedToken;

    IRateProvider private immutable _rateProvider;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens, //Index 0 main token and index 1 wrapped token
        IRateProvider rateProvider,
        uint256 priceRateCacheDuration,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
            name,
            symbol,
            tokens,
            new address[](tokens.length),
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _require(tokens.length == _TOTAL_TOKENS - 1, Errors.NOT_TWO_TOKENS);

        _mainToken = tokens[0];
        _wrappedToken = tokens[1];

        _vault = vault;

        _require(rateProvider != IRateProvider(address(0)), Errors.ZERO_RATE_PROVIDER);
        _rateProvider = rateProvider;
    }

    function onSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) public override returns (uint256) {
        return 0;
    }

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal override returns (uint256) {
        return 0;
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal override returns (uint256) {
        return 0;
    }

    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        whenNotPaused
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        revert();
    }

    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    )
        internal
        virtual
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        revert();
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal virtual override whenNotPaused returns (uint256, uint256[] memory) {
        revert();
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return 0;
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        uint256[] memory scalingFactors = new uint256[](_TOTAL_TOKENS);
        //scalingFactors[0] = _getScalingFactor0();
        //scalingFactors[1] = _getScalingFactor1();
        return scalingFactors;
    }

    function getRate() public view override returns (uint256) {
        return 0;
    }
}
