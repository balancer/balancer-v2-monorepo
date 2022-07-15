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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";

import "./BaseWeightedPool.sol";

abstract contract InvariantGrowthProtocolFees is BaseWeightedPool {
    using FixedPoint for uint256;

    // This Pool pays protocol fees by measuring the growth of the invariant between joins and exits. Since weights are
    // immutable, the invariant only changes due to accumulated swap fees, which saves gas by freeing the Pool
    // from performing any computation or accounting associated with protocol fees during swaps.
    // This mechanism requires keeping track of the invariant after the last join or exit.
    uint256 private _lastPostJoinExitInvariant;

    // Rate providers are used only for computing yield fees; they do not inform swap/join/exit
    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;
    IRateProvider internal immutable _rateProvider5;
    IRateProvider internal immutable _rateProvider6;
    IRateProvider internal immutable _rateProvider7;
    IRateProvider internal immutable _rateProvider8;
    IRateProvider internal immutable _rateProvider9;
    IRateProvider internal immutable _rateProvider10;
    IRateProvider internal immutable _rateProvider11;
    IRateProvider internal immutable _rateProvider12;
    IRateProvider internal immutable _rateProvider13;
    IRateProvider internal immutable _rateProvider14;
    IRateProvider internal immutable _rateProvider15;
    IRateProvider internal immutable _rateProvider16;
    IRateProvider internal immutable _rateProvider17;
    IRateProvider internal immutable _rateProvider18;
    IRateProvider internal immutable _rateProvider19;

    uint256 internal _lastRate0;
    uint256 internal _lastRate1;
    uint256 internal _lastRate2;
    uint256 internal _lastRate3;
    uint256 internal _lastRate4;
    uint256 internal _lastRate5;
    uint256 internal _lastRate6;
    uint256 internal _lastRate7;
    uint256 internal _lastRate8;
    uint256 internal _lastRate9;
    uint256 internal _lastRate10;
    uint256 internal _lastRate11;
    uint256 internal _lastRate12;
    uint256 internal _lastRate13;
    uint256 internal _lastRate14;
    uint256 internal _lastRate15;
    uint256 internal _lastRate16;
    uint256 internal _lastRate17;
    uint256 internal _lastRate18;
    uint256 internal _lastRate19;

    constructor(IRateProvider[] memory rateProviders) {
        uint256 numTokens = rateProviders.length;

        _rateProvider0 = rateProviders[0];
        _rateProvider1 = rateProviders[1];
        _rateProvider2 = numTokens > 2 ? rateProviders[2] : IRateProvider(0);
        _rateProvider3 = numTokens > 3 ? rateProviders[3] : IRateProvider(0);
        _rateProvider4 = numTokens > 4 ? rateProviders[4] : IRateProvider(0);
        _rateProvider5 = numTokens > 5 ? rateProviders[5] : IRateProvider(0);
        _rateProvider6 = numTokens > 6 ? rateProviders[6] : IRateProvider(0);
        _rateProvider7 = numTokens > 7 ? rateProviders[7] : IRateProvider(0);
        _rateProvider8 = numTokens > 8 ? rateProviders[8] : IRateProvider(0);
        _rateProvider9 = numTokens > 9 ? rateProviders[9] : IRateProvider(0);
        _rateProvider10 = numTokens > 10 ? rateProviders[10] : IRateProvider(0);
        _rateProvider11 = numTokens > 11 ? rateProviders[11] : IRateProvider(0);
        _rateProvider12 = numTokens > 12 ? rateProviders[12] : IRateProvider(0);
        _rateProvider13 = numTokens > 13 ? rateProviders[13] : IRateProvider(0);
        _rateProvider14 = numTokens > 14 ? rateProviders[14] : IRateProvider(0);
        _rateProvider15 = numTokens > 15 ? rateProviders[15] : IRateProvider(0);
        _rateProvider16 = numTokens > 16 ? rateProviders[16] : IRateProvider(0);
        _rateProvider17 = numTokens > 17 ? rateProviders[17] : IRateProvider(0);
        _rateProvider18 = numTokens > 18 ? rateProviders[18] : IRateProvider(0);
        _rateProvider19 = numTokens > 19 ? rateProviders[19] : IRateProvider(0);
    }

    /**
     * @dev Returns the value of the invariant after the last join or exit operation.
     */
    function getLastInvariant() public view returns (uint256) {
        return _lastPostJoinExitInvariant;
    }

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() external view returns (IRateProvider[] memory providers) {
        uint256 totalTokens = _getTotalTokens();
        providers = new IRateProvider[](totalTokens);

        // prettier-ignore
        {
            providers[0] = _rateProvider0;
            providers[1] = _rateProvider1;
            if (totalTokens > 2) { providers[2] = _rateProvider2; } else { return providers; }
            if (totalTokens > 3) { providers[3] = _rateProvider3; } else { return providers; }
            if (totalTokens > 4) { providers[4] = _rateProvider4; } else { return providers; }
            if (totalTokens > 5) { providers[5] = _rateProvider5; } else { return providers; }
            if (totalTokens > 6) { providers[6] = _rateProvider6; } else { return providers; }
            if (totalTokens > 7) { providers[7] = _rateProvider7; } else { return providers; }
            if (totalTokens > 8) { providers[8] = _rateProvider8; } else { return providers; }
            if (totalTokens > 9) { providers[9] = _rateProvider9; } else { return providers; }
            if (totalTokens > 10) { providers[10] = _rateProvider10; } else { return providers; }
            if (totalTokens > 11) { providers[11] = _rateProvider11; } else { return providers; }
            if (totalTokens > 12) { providers[12] = _rateProvider12; } else { return providers; }
            if (totalTokens > 13) { providers[13] = _rateProvider13; } else { return providers; }
            if (totalTokens > 14) { providers[14] = _rateProvider14; } else { return providers; }
            if (totalTokens > 15) { providers[15] = _rateProvider15; } else { return providers; }
            if (totalTokens > 16) { providers[16] = _rateProvider16; } else { return providers; }
            if (totalTokens > 17) { providers[17] = _rateProvider17; } else { return providers; }
            if (totalTokens > 18) { providers[18] = _rateProvider18; } else { return providers; }
            if (totalTokens > 19) { providers[19] = _rateProvider19; } else { return providers; }
        }
    }

    /**
     * @dev Returns the growth of each token's rate relative to 1
     */
    function _computeRateRatios() internal returns (uint256[] memory ratios) {
        uint256 totalTokens = _getTotalTokens();
        ratios = new uint256[](totalTokens);

        // prettier-ignore
        {
            uint256 rate = 0;
            if (_rateProvider0 != IRateProvider(0)) {
                rate = _rateProvider0.getRate();
                // Only collect fees if rate has increased
                if (rate > _lastRate0) {
                    ratios[0] = rate.divDown(_lastRate0);
                    // TODO: Updating this here means the comparison is against all-time high rate
                    _lastRate0 = rate;
                } else {
                    ratios[0] = FixedPoint.ONE;
                }
            } else {
                // TODO: duplicated
                ratios[0] = FixedPoint.ONE;
            }
            if (_rateProvider1 != IRateProvider(0)) {
                rate = _rateProvider1.getRate();
                if (rate > _lastRate1) {
                    ratios[1] = rate.divDown(_lastRate1);
                    _lastRate1 = rate;
                } else {
                    ratios[1] = FixedPoint.ONE;
                }
            } else {
                ratios[1] = FixedPoint.ONE;
            }
            if (totalTokens > 2) {
                if (_rateProvider2 != IRateProvider(0)) {
                    rate = _rateProvider2.getRate();
                    if (rate > _lastRate2) {
                        ratios[2] = rate.divDown(_lastRate2);
                        _lastRate2 = rate;
                    } else {
                        ratios[2] = FixedPoint.ONE;
                    }
                } else {
                    ratios[2] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 3) {
                if (_rateProvider3 != IRateProvider(0)) {
                    rate = _rateProvider3.getRate();
                    if (rate > _lastRate3) {
                        ratios[3] = rate.divDown(_lastRate3);
                        _lastRate3 = rate;
                    } else {
                        ratios[3] = FixedPoint.ONE;
                    }
                } else {
                    ratios[3] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 4) {
                if (_rateProvider4 != IRateProvider(0)) {
                    rate = _rateProvider4.getRate();
                    if (rate > _lastRate4) {
                        ratios[4] = rate.divDown(_lastRate4);
                        _lastRate4 = rate;
                    } else {
                        ratios[4] = FixedPoint.ONE;
                    }
                } else {
                    ratios[4] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 5) {
                if (_rateProvider5 != IRateProvider(0)) {
                    rate = _rateProvider5.getRate();
                    if (rate > _lastRate5) {
                        ratios[5] = rate.divDown(_lastRate5);
                        _lastRate5 = rate;
                    } else {
                        ratios[5] = FixedPoint.ONE;
                    }
                } else {
                    ratios[5] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 6) {
                if (_rateProvider6 != IRateProvider(0)) {
                    rate = _rateProvider6.getRate();
                    if (rate > _lastRate6) {
                        ratios[6] = rate.divDown(_lastRate6);
                        _lastRate6 = rate;
                    } else {
                        ratios[6] = FixedPoint.ONE;
                    }
                } else {
                    ratios[6] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 7) {
                if (_rateProvider7 != IRateProvider(0)) {
                    rate = _rateProvider7.getRate();
                    if (rate > _lastRate7) {
                        ratios[7] = rate.divDown(_lastRate7);
                        _lastRate7 = rate;
                    } else {
                        ratios[7] = FixedPoint.ONE;
                    }
                } else {
                    ratios[7] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 8) {
                if (_rateProvider8 != IRateProvider(0)) {
                    rate = _rateProvider8.getRate();
                    if (rate > _lastRate8) {
                        ratios[8] = rate.divDown(_lastRate8);
                        _lastRate8 = rate;
                    } else {
                        ratios[8] = FixedPoint.ONE;
                    }
                } else {
                    ratios[8] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 9) {
                if (_rateProvider9 != IRateProvider(0)) {
                    rate = _rateProvider9.getRate();
                    if (rate > _lastRate9) {
                        ratios[9] = rate.divDown(_lastRate9);
                        _lastRate9 = rate;
                    } else {
                        ratios[9] = FixedPoint.ONE;
                    }
                } else {
                    ratios[9] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 10) {
                if (_rateProvider10 != IRateProvider(0)) {
                    rate = _rateProvider10.getRate();
                    if (rate > _lastRate10) {
                        ratios[10] = rate.divDown(_lastRate10);
                        _lastRate10 = rate;
                    } else {
                        ratios[10] = FixedPoint.ONE;
                    }
                } else {
                    ratios[10] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 11) {
                if (_rateProvider11 != IRateProvider(0)) {
                    rate = _rateProvider11.getRate();
                    if (rate > _lastRate11) {
                        ratios[11] = rate.divDown(_lastRate11);
                        _lastRate11 = rate;
                    } else {
                        ratios[11] = FixedPoint.ONE;
                    }
                } else {
                    ratios[11] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 12) {
                if (_rateProvider12 != IRateProvider(0)) {
                    rate = _rateProvider12.getRate();
                    if (rate > _lastRate12) {
                        ratios[12] = rate.divDown(_lastRate12);
                        _lastRate12 = rate;
                    } else {
                        ratios[12] = FixedPoint.ONE;
                    }
                } else {
                    ratios[12] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 13) {
                if (_rateProvider13 != IRateProvider(0)) {
                    rate = _rateProvider13.getRate();
                    if (rate > _lastRate13) {
                        ratios[13] = rate.divDown(_lastRate13);
                        _lastRate13 = rate;
                    } else {
                        ratios[13] = FixedPoint.ONE;
                    }
                } else {
                    ratios[13] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 14) {
                if (_rateProvider14 != IRateProvider(0)) {
                    rate = _rateProvider14.getRate();
                    if (rate > _lastRate14) {
                        ratios[14] = rate.divDown(_lastRate14);
                        _lastRate14 = rate;
                    } else {
                        ratios[14] = FixedPoint.ONE;
                    }
                } else {
                    ratios[14] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 15) {
                if (_rateProvider15 != IRateProvider(0)) {
                    rate = _rateProvider15.getRate();
                    if (rate > _lastRate15) {
                        ratios[15] = rate.divDown(_lastRate15);
                        _lastRate15 = rate;
                    } else {
                        ratios[15] = FixedPoint.ONE;
                    }
                } else {
                    ratios[15] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 16) {
                if (_rateProvider16 != IRateProvider(0)) {
                    rate = _rateProvider16.getRate();
                    if (rate > _lastRate16) {
                        ratios[16] = rate.divDown(_lastRate16);
                        _lastRate16 = rate;
                    } else {
                        ratios[16] = FixedPoint.ONE;
                    }
                } else {
                    ratios[16] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 17) {
                if (_rateProvider17 != IRateProvider(0)) {
                    rate = _rateProvider17.getRate();
                    if (rate > _lastRate17) {
                        ratios[17] = rate.divDown(_lastRate17);
                        _lastRate17 = rate;
                    } else {
                        ratios[17] = FixedPoint.ONE;
                    }
                } else {
                    ratios[17] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 18) {
                if (_rateProvider18 != IRateProvider(0)) {
                    rate = _rateProvider18.getRate();
                    if (rate > _lastRate18) {
                        ratios[18] = rate.divDown(_lastRate18);
                        _lastRate18 = rate;
                    } else {
                        ratios[18] = FixedPoint.ONE;
                    }
                } else {
                    ratios[18] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
            if (totalTokens > 19) {
                if (_rateProvider19 != IRateProvider(0)) {
                    rate = _rateProvider19.getRate();
                    if (rate > _lastRate19) {
                        ratios[19] = rate.divDown(_lastRate19);
                        _lastRate19 = rate;
                    } else {
                        ratios[19] = FixedPoint.ONE;
                    }
                } else {
                    ratios[19] = FixedPoint.ONE;
                }
            } else {
                return ratios;
            }
        }
    }

    function _beforeJoinExit(
        uint256[] memory preBalances,
        uint256[] memory normalizedWeights,
        uint256 protocolSwapFeePercentage
    ) internal virtual override {
        // Before joins and exits, we measure the growth of the invariant compared to the invariant after the last join
        // or exit, which will have been caused by swap fees, and use it to mint BPT as protocol fees. This dilutes all
        // LPs, which means that new LPs will join the pool debt-free, and exiting LPs will pay any amounts due
        // before leaving.

        // We return immediately if the fee percentage is zero (to avoid unnecessary computation), or when the pool is
        // paused (to avoid complex computation during emergency withdrawals).
        if ((protocolSwapFeePercentage == 0) || !_isNotPaused()) {
            return;
        }

        uint256 preJoinExitInvariant = WeightedMath._calculateInvariant(normalizedWeights, preBalances);

        uint256 bptSwapFees = WeightedMath._calcDueProtocolSwapFeeBptAmount(
            totalSupply(),
            _lastPostJoinExitInvariant,
            preJoinExitInvariant,
            protocolSwapFeePercentage
        );

        uint256 updatedSupply = totalSupply().add(bptSwapFees);

        uint256[] memory rateRatios = _computeRateRatios();
        uint256 rateGrowthProduct = WeightedMath._calculateWeightedProduct(normalizedWeights, rateRatios);

        uint256 bptYieldFees = WeightedMath._calcDueProtocolSwapFeeBptAmount(
            updatedSupply,
            FixedPoint.ONE,
            rateGrowthProduct,
            // TODO: This fee pct should come from a different source
            protocolSwapFeePercentage
        );

        _payProtocolFees(bptSwapFees.add(bptYieldFees));
    }

    function _afterJoinExit(
        bool isJoin,
        uint256[] memory preBalances,
        uint256[] memory balanceDeltas,
        uint256[] memory normalizedWeights
    ) internal virtual override {
        // After all joins and exits we store the post join/exit invariant in order to compute growth due to swap fees
        // in the next one.

        // Compute the post balances by adding or removing the deltas. Note that we're allowed to mutate preBalances.
        for (uint256 i = 0; i < preBalances.length; ++i) {
            // Cannot optimize calls with a function selector: there are 2- and 3-argument versions of SafeMath.sub
            preBalances[i] = isJoin
                ? SafeMath.add(preBalances[i], balanceDeltas[i])
                : SafeMath.sub(preBalances[i], balanceDeltas[i]);
        }

        uint256 postJoinExitInvariant = WeightedMath._calculateInvariant(normalizedWeights, preBalances);
        _lastPostJoinExitInvariant = postJoinExitInvariant;
    }
}
