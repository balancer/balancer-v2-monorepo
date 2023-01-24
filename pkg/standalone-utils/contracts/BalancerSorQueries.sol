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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

enum TotalSupplyType { TOTAL_SUPPLY, VIRTUAL_SUPPLY, ACTUAL_SUPPLY }
enum SwapFeeType { SWAP_FEE_PERCENTAGE, PERCENT_FEE }

// The base ILinearPool does not include getWrappedTokenRate, so we redefine it here.
interface ILinearPool {
    function getWrappedTokenRate() external view returns (uint256);
}

interface IWeightedPool {
    function getNormalizedWeights() external view returns (uint256[] memory);
}

interface IPoolWithTokenRates {
    function getTokenRate(IERC20 token) external view returns (uint256);
}

interface IPoolWithActualSupply {
    function getActualSupply() external view returns (uint256);
}

interface IPoolWithVirtualSupply {
    function getVirtualSupply() external view returns (uint256);
}

interface IPoolWithSwapFeePercentage {
    function getSwapFeePercentage() external view returns (uint256);
}

interface IPoolWithPercentFee {
    function percentFee() external view returns (uint256);
}

/**
 * @dev This contract builds on top of the Balancer V2 architecture to provide useful helpers for SOR
 * (Smart order router) initialization. It allows for bulking actions for many pools at once, with the overall goal
 * to reduce network-in and network-out required for loading necessary onchain data in SOR initialization.
 */
contract BalancerSorQueries {
    IVault public immutable vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    function getPoolTokenBalancesWithUpdatesAfterBlock(bytes32[] memory poolIds, uint256 blockNumber)
        external
        view
        returns (uint256[][] memory)
    {
        uint256[] memory balances;
        uint256 lastChangeBlock;
        uint256[][] memory allBalances = new uint256[][](poolIds.length);

        for (uint256 i = 0; i < poolIds.length; i++) {
            (, balances, lastChangeBlock) = vault.getPoolTokens(poolIds[i]);

            if (lastChangeBlock > blockNumber) {
                allBalances[i] = balances;
            }
        }

        return allBalances;
    }

    function getWrappedTokenRateForLinearPools(address[] memory poolAddresses)
        external
        view
        returns (uint256[] memory)
    {
        uint256[] memory rates = new uint256[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            rates[i] = _getLinearWrappedTokenRate(poolAddresses[i]);
        }

        return rates;
    }

    function getSwapFeePercentageForPools(address[] memory poolAddresses, SwapFeeType[] memory swapFeeTypes)
        external
        view
        returns (uint256[] memory)
    {
        uint256[] memory swapFees = new uint256[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            if (swapFeeTypes[i] == SwapFeeType.PERCENT_FEE) {
                swapFees[i] = IPoolWithPercentFee(poolAddresses[i]).percentFee();
            } else {
                swapFees[i] = IPoolWithSwapFeePercentage(poolAddresses[i]).getSwapFeePercentage();
            }
        }

        return swapFees;
    }

    function getTotalSupplyForPools(address[] memory poolAddresses, TotalSupplyType[] memory totalSupplyTypes)
        external
        view
        returns (uint256[] memory)
    {
        uint256[] memory totalSupplies = new uint256[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            if (totalSupplyTypes[i] == TotalSupplyType.VIRTUAL_SUPPLY) {
                totalSupplies[i] = _getPoolVirtualSupply(poolAddresses[i]);
            } else if (totalSupplyTypes[i] == TotalSupplyType.ACTUAL_SUPPLY) {
                totalSupplies[i] = _getPoolActualSupply(poolAddresses[i]);
            } else {
                totalSupplies[i] = IERC20(poolAddresses[i]).totalSupply();
            }
        }

        return totalSupplies;
    }

    function getNormalizedWeightsForPools(address[] memory poolAddresses) external view returns (uint256[][] memory) {
        uint256[][] memory allWeights = new uint256[][](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            allWeights[i] = IWeightedPool(poolAddresses[i]).getNormalizedWeights();
        }

        return allWeights;
    }

    function getTokenRatesForPools(bytes32[] memory poolIds) external view returns (uint256[][] memory) {
        uint256[][] memory allRates = new uint256[][](poolIds.length);
        address pool;
        IERC20[] memory tokens;

        for (uint256 i = 0; i < poolIds.length; i++) {
            (pool, ) = vault.getPool(poolIds[i]);
            (tokens, , ) = vault.getPoolTokens(poolIds[i]);
            allRates[i] = new uint256[](tokens.length);

            for (uint256 j = 0; j < tokens.length; j++) {
                allRates[i][j] = IPoolWithTokenRates(pool).getTokenRate(tokens[j]);
            }
        }

        return allRates;
    }

    function _getLinearWrappedTokenRate(address poolAddress) internal view returns (uint256) {
        try ILinearPool(poolAddress).getWrappedTokenRate() returns (uint256 rate) {
            return rate;
        } catch {
            return 0;
        }
    }

    function _getPoolVirtualSupply(address poolAddress) internal view returns (uint256) {
        try IPoolWithVirtualSupply(poolAddress).getVirtualSupply() returns (uint256 virtualSupply) {
            return virtualSupply;
        } catch {
            return 0;
        }
    }

    function _getPoolActualSupply(address poolAddress) internal view returns (uint256) {
        try IPoolWithActualSupply(poolAddress).getActualSupply() returns (uint256 actualSupply) {
            return actualSupply;
        } catch {
            return 0;
        }
    }
}
