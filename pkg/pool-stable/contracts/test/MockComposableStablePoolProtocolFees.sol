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

import "../ComposableStablePoolProtocolFees.sol";

contract MockComposableStablePoolProtocolFees is ComposableStablePoolProtocolFees {
    constructor(
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        IERC20[] memory tokens,
        IRateProvider[] memory tokenRateProviders,
        uint256[] memory tokenRateCacheDurations,
        bool[] memory exemptFromYieldProtocolFeeFlags
    )
        ComposableStablePoolStorage(
            StorageParams({
                registeredTokens: _insertSorted(tokens, IERC20(this)),
                tokenRateProviders: tokenRateProviders,
                exemptFromYieldProtocolFeeFlags: exemptFromYieldProtocolFeeFlags
            })
        )
        ComposableStablePoolRates(
            RatesParams({
                tokens: tokens,
                rateProviders: tokenRateProviders,
                tokenRateCacheDurations: tokenRateCacheDurations
            })
        )
        ProtocolFeeCache(
            protocolFeeProvider,
            ProviderFeeIDs({ swap: ProtocolFeeType.SWAP, yield: ProtocolFeeType.YIELD, aum: ProtocolFeeType.AUM })
        )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            "MockStablePoolStorage",
            "MOCK_BPT",
            _insertSorted(tokens, IERC20(this)),
            new address[](tokens.length + 1),
            1e12, // BasePool._MIN_SWAP_FEE_PERCENTAGE
            0,
            0,
            address(0)
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function payProtocolFeesBeforeJoinExit(
        uint256[] memory registeredBalances,
        uint256 lastJoinExitAmp,
        uint256 lastPostJoinExitInvariant
    ) external returns (uint256 virtualSupply, uint256[] memory balances) {
        (virtualSupply, balances, ) = _payProtocolFeesBeforeJoinExit(
            registeredBalances,
            lastJoinExitAmp,
            lastPostJoinExitInvariant
        );
    }

    function updateInvariantAfterJoinExit(
        uint256 currentAmp,
        uint256[] memory balances,
        uint256 preJoinExitInvariant,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) external {
        return
            _updateInvariantAfterJoinExit(
                currentAmp,
                balances,
                preJoinExitInvariant,
                preJoinExitSupply,
                postJoinExitSupply
            );
    }

    function updatePostJoinExit(uint256 currentAmp, uint256 postJoinExitInvariant) external {
        _updatePostJoinExit(currentAmp, postJoinExitInvariant);
    }

    function setTotalSupply(uint256 newSupply) external {
        _setTotalSupply(newSupply);
    }

    function getGrowthInvariants(uint256[] memory balances, uint256 lastPostJoinExitAmp)
        external
        view
        returns (
            uint256 swapFeeGrowthInvariant,
            uint256 totalNonExemptGrowthInvariant,
            uint256 totalGrowthInvariant
        )
    {
        return _getGrowthInvariants(balances, lastPostJoinExitAmp);
    }

    function getProtocolPoolOwnershipPercentage(
        uint256[] memory balances,
        uint256 lastJoinExitAmp,
        uint256 lastPostJoinExitInvariant
    ) external view returns (uint256) {
        (uint256 percentage, ) = _getProtocolPoolOwnershipPercentage(
            balances,
            lastJoinExitAmp,
            lastPostJoinExitInvariant
        );
        return percentage;
    }

    // Stubbed functions

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {}

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
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
