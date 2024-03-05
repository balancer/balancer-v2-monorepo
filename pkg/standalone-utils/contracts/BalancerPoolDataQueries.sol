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
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/ITemporarilyPausable.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRecoveryMode.sol";

enum TotalSupplyType { TOTAL_SUPPLY, VIRTUAL_SUPPLY, ACTUAL_SUPPLY }
enum SwapFeeType { SWAP_FEE_PERCENTAGE, PERCENT_FEE }

// The base ILinearPool does not include getWrappedTokenRate, so we redefine it here.
interface ILinearPool {
    function getWrappedTokenRate() external view returns (uint256);

    function getTargets() external view returns (uint256 lowerTarget, uint256 upperTarget);
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
    bool loadLinearTargets;
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

struct PoolStatusQueryConfig {
    bool loadInRecoveryMode;
    bool loadIsPaused;
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

    /**
     * @dev Under most circumstances, you will use getPoolData as the main entry point for this contract.
     * It allows you to fetch various types of pool data for many pools in a single query. The response
     * is optimized for data out. We return the minimum amount of data from this query to facilitate
     * faster network requests. getPoolData replaces the generic multicall approach that over fetches data
     * in most situations and will revert if any query in the multicall reverts, making it difficult to identify
     * pools that need to be filtered from routing. This function returns an array ignoreIdxs that contains the
     * enumerated idxs in the poolIds array that should be filtered out.
     */
    function getPoolData(bytes32[] memory poolIds, PoolDataQueryConfig memory config)
        external
        view
        returns (
            uint256[][] memory balances,
            uint256[] memory totalSupplies,
            uint256[] memory swapFees,
            uint256[] memory linearWrappedTokenRates,
            uint256[][] memory linearTargets,
            uint256[][] memory weights,
            uint256[][] memory scalingFactors,
            uint256[] memory amps,
            uint256[] memory rates,
            uint256[] memory ignoreIdxs
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

        if (config.loadLinearTargets) {
            address[] memory linearTargetPools = new address[](config.linearPoolIdxs.length);

            for (i = 0; i < config.linearPoolIdxs.length; i++) {
                linearTargetPools[i] = pools[config.linearPoolIdxs[i]];
            }

            linearTargets = getLinearTargetsForPools(linearTargetPools);
        }

        ignoreIdxs = _getErrorIdxsFromResults(
            poolIds,
            config,
            totalSupplies,
            swapFees,
            linearWrappedTokenRates,
            amps,
            rates,
            scalingFactors,
            weights
        );
    }

    function getPoolStatus(bytes32[] memory poolIds, PoolStatusQueryConfig memory config)
        external
        view
        returns (bool[] memory isPaused, bool[] memory inRecoveryMode)
    {
        uint256 i;
        address[] memory pools = new address[](poolIds.length);

        for (i = 0; i < poolIds.length; i++) {
            (pools[i], ) = vault.getPool(poolIds[i]);
        }

        if (config.loadIsPaused) {
            isPaused = getIsPausedForPools(pools);
        }

        if (config.loadInRecoveryMode) {
            inRecoveryMode = getInRecoveryModeForPools(pools);
        }
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
            amps[i] = _getPoolAmp(poolAddresses[i]);
        }

        return amps;
    }

    function getRateForPools(address[] memory poolAddresses) public view returns (uint256[] memory) {
        uint256[] memory rates = new uint256[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            rates[i] = _getPoolRate(poolAddresses[i]);
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
                try IPoolWithPercentFee(poolAddresses[i]).percentFee() returns (uint256 swapFee) {
                    swapFees[i] = swapFee;
                } catch {
                    swapFees[i] = 0;
                }
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
                totalSupplies[i] = _getPoolTotalSupply(poolAddresses[i]);
            }
        }

        return totalSupplies;
    }

    function getNormalizedWeightsForPools(address[] memory poolAddresses) public view returns (uint256[][] memory) {
        uint256[][] memory allWeights = new uint256[][](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            allWeights[i] = _getPoolNormalizedWeights(poolAddresses[i]);
        }

        return allWeights;
    }

    function getScalingFactorsForPools(address[] memory poolAddresses) public view returns (uint256[][] memory) {
        uint256[][] memory allScalingFactors = new uint256[][](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            allScalingFactors[i] = _getPoolScalingFactors(poolAddresses[i]);
        }

        return allScalingFactors;
    }

    function getLinearTargetsForPools(address[] memory poolAddresses) public view returns (uint256[][] memory) {
        uint256[][] memory linearTargets = new uint256[][](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            linearTargets[i] = _getPoolLinearTargets(poolAddresses[i]);
        }

        return linearTargets;
    }

    function getInRecoveryModeForPools(address[] memory poolAddresses) public view returns (bool[] memory) {
        bool[] memory inRecoveryModes = new bool[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            inRecoveryModes[i] = _getPoolInRecoveryMode(poolAddresses[i]);
        }

        return inRecoveryModes;
    }

    function getIsPausedForPools(address[] memory poolAddresses) public view returns (bool[] memory) {
        bool[] memory isPaused = new bool[](poolAddresses.length);

        for (uint256 i = 0; i < poolAddresses.length; i++) {
            isPaused[i] = _getPoolIsPaused(poolAddresses[i]);
        }

        return isPaused;
    }

    /**
     * @dev Our goal is to prevent queries from reverting even if one or more pools are in an invalid/corrupt state.
     * We wrap each query below in a try/catch block, and return a value of 0 in instances where the query reverts.
     * We use a 0 value as our sentinel value, but recognize it is possible for pools to return a 0 value in non error
     * situations (ie: pool is uninitialized). In such situations, it is still appropriate for us to flag the pool to
     * be ignored.
     */
    function _getLinearWrappedTokenRate(address poolAddress) internal view returns (uint256) {
        try ILinearPool(poolAddress).getWrappedTokenRate() returns (uint256 rate) {
            return rate;
        } catch {
            return 0;
        }
    }

    function _getPoolLinearTargets(address poolAddress) internal view returns (uint256[] memory) {
        uint256[] memory targets = new uint256[](2);

        (targets[0], targets[1]) = ILinearPool(poolAddress).getTargets();

        return targets;
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

    function _getPoolTotalSupply(address poolAddress) internal view returns (uint256) {
        try IERC20(poolAddress).totalSupply() returns (uint256 totalSupply) {
            return totalSupply;
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

    function _getPoolScalingFactors(address poolAddress) internal view returns (uint256[] memory) {
        try IPoolWithScalingFactors(poolAddress).getScalingFactors() returns (uint256[] memory scalingFactors) {
            return scalingFactors;
        } catch {
            uint256[] memory empty = new uint256[](0);

            return empty;
        }
    }

    function _getPoolNormalizedWeights(address poolAddress) internal view returns (uint256[] memory) {
        try IWeightedPool(poolAddress).getNormalizedWeights() returns (uint256[] memory normalizedWeights) {
            return normalizedWeights;
        } catch {
            uint256[] memory empty = new uint256[](0);

            return empty;
        }
    }

    function _getPoolAmp(address poolAddress) internal view returns (uint256) {
        try IPoolWithAmp(poolAddress).getAmplificationParameter() returns (uint256 value, bool, uint256) {
            return value;
        } catch {
            return 0;
        }
    }

    function _getPoolInRecoveryMode(address poolAddress) internal view returns (bool) {
        try IRecoveryMode(poolAddress).inRecoveryMode() returns (bool inRecoveryMode) {
            return inRecoveryMode;
        } catch {
            return false;
        }
    }

    function _getPoolIsPaused(address poolAddress) internal view returns (bool) {
        try ITemporarilyPausable(poolAddress).getPausedState() returns (bool paused, uint256, uint256) {
            return paused;
        } catch {
            return false;
        }
    }

    function _getErrorIdxsFromResults(
        bytes32[] memory poolIds,
        PoolDataQueryConfig memory config,
        uint256[] memory totalSupplies,
        uint256[] memory swapFees,
        uint256[] memory linearWrappedTokenRates,
        uint256[] memory amps,
        uint256[] memory rates,
        uint256[][] memory scalingFactors,
        uint256[][] memory weights
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

        if (config.loadScalingFactors) {
            for (i = 0; i < config.scalingFactorPoolIdxs.length; i++) {
                // any failed fetches to scaling factors returns an empty array
                if (scalingFactors[i].length == 0) {
                    errors[config.scalingFactorPoolIdxs[i]] = true;
                }
            }
        }

        if (config.loadNormalizedWeights) {
            for (i = 0; i < config.weightedPoolIdxs.length; i++) {
                // any failed fetches to normalized weights returns an empty array
                if (weights[i].length == 0) {
                    errors[config.weightedPoolIdxs[i]] = true;
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
