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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";

import "../ComposableStablePoolRates.sol";

contract MockComposableStablePoolRates is ComposableStablePoolRates {
    constructor(
        IVault vault,
        IERC20[] memory tokens,
        IRateProvider[] memory tokenRateProviders,
        uint256[] memory tokenRateCacheDurations,
        bool[] memory exemptFromYieldProtocolFeeFlags,
        uint256 swapFeePercentage,
        address owner
    )
        ComposableStablePoolRates(RatesParams(tokens, tokenRateProviders, tokenRateCacheDurations))
        ComposableStablePoolStorage(
            StorageParams(tokens, tokenRateProviders, exemptFromYieldProtocolFeeFlags, swapFeePercentage)
        )
        NewBasePool(
            vault,
            PoolRegistrationLib.registerComposablePool(
                vault,
                IVault.PoolSpecialization.GENERAL,
                tokens,
                new address[](tokens.length)
            ),
            "MockStablePoolStorage",
            "MOCK_BPT",
            0,
            0,
            owner
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function cacheTokenRatesIfNecessary() external {
        _cacheTokenRatesIfNecessary();
    }

    function cacheTokenRateIfNecessary(IERC20 token) external {
        _cacheTokenRateIfNecessary(_getPoolTokenIndex(token));
    }

    function updateOldRates() external {
        _updateOldRates();
    }

    function getAdjustedBalances(uint256[] memory balances, bool ignoreExemptFlags)
        external
        view
        returns (uint256[] memory)
    {
        return _getAdjustedBalances(balances, ignoreExemptFlags);
    }

     function _onSwapMinimal(
        SwapRequest memory,
        uint256,
        uint256
    ) internal virtual override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onSwapGeneral(
        SwapRequest memory,
        uint256[] memory,
        uint256,
        uint256 
    ) internal virtual override  returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }  

    function _onInitializePool(
        address,
        address,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onJoinPool(
        address,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onExitPool(
        address,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _doRecoveryModeExit(
        uint256[] memory,
        uint256,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }
}
