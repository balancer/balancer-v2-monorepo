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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";
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

interface IPoolWithScalingFactors {
    function getScalingFactors() external view returns (uint256[] memory);
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

interface IPoolWithAmp {
    function getAmplificationParameter()
        external
        view
        returns (
            uint256 value,
            bool isUpdating,
            uint256 precision
        );
}

struct PoolDataQueryConfig {
    bool loadTokenBalanceUpdatesAfterBlock;
    bool loadTotalSupply;
    bool loadSwapFees;
    bool loadLinearWrappedTokenRates;
    bool loadNormalizedWeights;
    bool loadScalingFactors;
    bool loadAmps;
    bool loadRates;
    uint256 blockNumber;
    TotalSupplyType[] totalSupplyTypes;
    SwapFeeType[] swapFeeTypes;
    uint256[] linearPoolIdxs;
    uint256[] weightedPoolIdxs;
    uint256[] scalingFactorPoolIdxs;
    uint256[] ampPoolIdxs;
    uint256[] ratePoolIdxs;
}

/**
 * @dev This contract builds on top of the Balancer V2 architecture to provide useful helpers for fetching on chain data
 * for Balancer pools. It is especially helpful for SOR (Smart order router) initialization. It allows for bulking
 * actions for many pools at once, with the overall goal to reduce network-in and network-out required for loading
 * useful onchain data.
 */
contract BalancerPoolDataQueries {
    IVault public immutable vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    function getPoolData(bytes32[] memory poolIds, PoolDataQueryConfig memory config)
        external
        view
        returns (
            uint256[][] memory balances,
            uint256[] memory totalSupplies,
            uint256[] memory swapFees,
            uint256[] memory linearWrappedTokenRates,
            uint256[][] memory weights,
            uint256[][] memory scalingFactors,
            uint256[] memory amps,
            uint256[] memory rates,
            uint256[] memory errorIdxs
        )
    {
        uint256 i;
        address[] memory pools = new address[](poolIds.length);

        for (i = 0; i < poolIds.length; i++) {
            (pools[i], ) = vault.getPool(poolIds[i]);
        }

        if (config.loadTokenBalanceUpdatesAfterBlock) {
            balances = getPoolTokenBalancesWithUpdatesAfterBlock(poolIds, config.blockNumber);
        }

        if (config.loadTotalSupply) {
            totalSupplies = getTotalSupplyForPools(pools, config.totalSupplyTypes);
        }

        if (config.loadSwapFees) {
            swapFees = getSwapFeePercentageForPools(pools, config.swapFeeTypes);
        }

        if (config.loadLinearWrappedTokenRates) {
            address[] memory linearPools = new address[](config.linearPoolIdxs.length);

            for (i = 0; i < config.linearPoolIdxs.length; i++) {
                linearPools[i] = pools[config.linearPoolIdxs[i]];
            }

            linearWrappedTokenRates = getWrappedTokenRateForLinearPools(linearPools);
        }

        if (config.loadNormalizedWeights) {
            address[] memory weightedPools = new address[](config.weightedPoolIdxs.length);

            for (i = 0; i < config.weightedPoolIdxs.length; i++) {
                weightedPools[i] = pools[config.weightedPoolIdxs[i]];
            }

            weights = getNormalizedWeightsForPools(weightedPools);
        }

        if (config.loadScalingFactors) {
            address[] memory scalingFactorPools = new address[](config.scalingFactorPoolIdxs.length);

            for (i = 0; i < config.scalingFactorPoolIdxs.length; i++) {
                scalingFactorPools[i] = pools[config.scalingFactorPoolIdxs[i]];
            }

            scalingFactors = getScalingFactorsForPools(scalingFactorPools);
        }

        if (config.loadAmps) {
            address[] memory ampPools = new address[](config.ampPoolIdxs.length);

            for (i = 0; i < config.ampPoolIdxs.length; i++) {
                ampPools[i] = pools[config.ampPoolIdxs[i]];
            }

            amps = getAmpForPools(ampPools);
        }

        if (config.loadRates) {
            address[] memory ratePools = new address[](config.ratePoolIdxs.length);

            for (i = 0; i < config.ratePoolIdxs.length; i++) {
                ratePools[i] = pools[config.ratePoolIdxs[i]];
            }

            rates = getRateForPools(ratePools);
        }

        errorIdxs = _getErrorsIdxsFromResults(
            poolIds,
            config,
            totalSupplies,
            swapFees,
            linearWrappedTokenRates,
            amps,
            rates
        );
    }

    function getPoolTokenBalancesWithUpdatesAfterBlock(bytes32[] memory poolIds, uint256 blockNumber)
        public
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

    function getWrappedTokenRateForLinearPools(address[] memory poolAddresses) public view returns (uint256[] memory) {
        uint256[] memory rates = new uint256[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            rates[i] = _getLinearWrappedTokenRate(poolAddresses[i]);
        }

        return rates;
    }

    function getAmpForPools(address[] memory poolAddresses) public view returns (uint256[] memory) {
        uint256[] memory amps = new uint256[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            (amps[i], , ) = IPoolWithAmp(poolAddresses[i]).getAmplificationParameter();
        }

        return amps;
    }

    function getRateForPools(address[] memory poolAddresses) public view returns (uint256[] memory) {
        uint256[] memory rates = new uint256[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            rates[i] =  _getPoolRate(poolAddresses[i]);
        }

        return rates;
    }

    function getSwapFeePercentageForPools(address[] memory poolAddresses, SwapFeeType[] memory swapFeeTypes)
        public
        view
        returns (uint256[] memory)
    {
        uint256[] memory swapFees = new uint256[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            if (swapFeeTypes[i] == SwapFeeType.PERCENT_FEE) {
                swapFees[i] = IPoolWithPercentFee(poolAddresses[i]).percentFee();
            } else {
                // In instances where we get an unknown pool type that does not support the default getSwapFeePercentage
                // we return a 0 swap fee.
                try IPoolWithSwapFeePercentage(poolAddresses[i]).getSwapFeePercentage() returns (uint256 swapFee) {
                    swapFees[i] = swapFee;
                } catch {
                    swapFees[i] = 0;
                }
            }
        }

        return swapFees;
    }

    function getTotalSupplyForPools(address[] memory poolAddresses, TotalSupplyType[] memory totalSupplyTypes)
        public
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

    function getNormalizedWeightsForPools(address[] memory poolAddresses) public view returns (uint256[][] memory) {
        uint256[][] memory allWeights = new uint256[][](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            allWeights[i] = IWeightedPool(poolAddresses[i]).getNormalizedWeights();
        }

        return allWeights;
    }

    function getScalingFactorsForPools(address[] memory poolAddresses) public view returns (uint256[][] memory) {
        uint256[][] memory allScalingFactors = new uint256[][](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            allScalingFactors[i] = IPoolWithScalingFactors(poolAddresses[i]).getScalingFactors();
        }

        return allScalingFactors;
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

    function _getPoolRate(address poolAddress) internal view returns (uint256) {
        try IRateProvider(poolAddress).getRate() returns (uint256 rate) {
            return rate;
        } catch {
            return 0;
        }
    }

    function _getErrorsIdxsFromResults(
        bytes32[] memory poolIds,
        PoolDataQueryConfig memory config,
        uint256[] memory totalSupplies,
        uint256[] memory swapFees,
        uint256[] memory linearWrappedTokenRates,
        uint256[] memory amps,
        uint256[] memory rates
    ) internal pure returns (uint256[] memory) {
        bool[] memory errors = new bool[](poolIds.length);
        uint256 numErrors = 0;
        uint256 i;

        for (i = 0; i < poolIds.length; i++) {
            if ((config.loadTotalSupply && totalSupplies[i] == 0) || (config.loadSwapFees && swapFees[i] == 0)) {
                errors[i] = true;
            }
        }

        if (config.loadLinearWrappedTokenRates) {
            for (i = 0; i < config.linearPoolIdxs.length; i++) {
                if (linearWrappedTokenRates[i] == 0) {
                    errors[config.linearPoolIdxs[i]] = true;
                }
            }
        }

        if (config.loadAmps) {
            for (i = 0; i < config.ampPoolIdxs.length; i++) {
                if (amps[i] == 0) {
                    errors[config.ampPoolIdxs[i]] = true;
                }
            }
        }

        if (config.loadRates) {
            for (i = 0; i < config.ratePoolIdxs.length; i++) {
                if (rates[i] == 0) {
                    errors[config.ratePoolIdxs[i]] = true;
                }
            }
        }

        for (i = 0; i < errors.length; i++) {
            if (errors[i] == true) {
                numErrors++;
            }
        }

        uint256[] memory errorIdxs = new uint256[](numErrors);
        uint256 idx = 0;

        for (i = 0; i < errors.length; i++) {
            if (errors[i] == true) {
                errorIdxs[idx] = i;
                idx++;
            }
        }

        return errorIdxs;
    }
}
