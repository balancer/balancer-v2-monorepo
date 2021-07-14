import { range } from 'lodash';
import { BigNumber, Contract } from 'ethers';

import { bn, pct } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { calculateBptPrice, calculateSpotPrice } from '@balancer-labs/v2-helpers/src/models/pools/stable/math';

const MAX_RELATIVE_ERROR = 0.0001; // 0.01%, or ~e^0.0001

describe('StableOracleMath', function () {
  let mock: Contract;

  before(async function () {
    mock = await deploy('MockStableOracleMath');
  });

  const AMP_PRECISION = 1e3;
  const DELTAS = [-0.2, -0.03, 0, 0.03, 0.2];
  const BASES = [0.4, 1.2, 2.9, 3.3, 4.8, 5.3, 6.1, 7.4, 8.5, 9.4];

  const balancesOfMagnitude = (power: number, delta: number): BigNumber[][] => {
    return BASES.map((base) => {
      const balanceX = bn(base * 10 ** power);
      const balanceY = balanceX.add(pct(balanceX, delta));
      return [balanceX, balanceY];
    });
  };

  describe('spot price', () => {
    context('with low amp', () => {
      const amp = bn(200);
      itComputesSpotPriceWithError(amp);
    });

    context('with mid amp', () => {
      const amp = bn(2000);
      itComputesSpotPriceWithError(amp);
    });

    context('with high amp', () => {
      const amp = bn(5000);
      itComputesSpotPriceWithError(amp);
    });

    function itComputesSpotPriceWithError(amp: BigNumber) {
      const minPower = 18;
      const maxPower = 26;

      for (const power of range(minPower, maxPower)) {
        context(`with balances of magnitude e${power}`, () => {
          for (const delta of DELTAS) {
            context(`with deltas of magnitude ${delta}`, () => {
              it('computes log spot price with bounded relative error', async () => {
                for (const balances of balancesOfMagnitude(power, delta)) {
                  const logSpotPrice = await mock.calcLogSpotPrice(amp.mul(AMP_PRECISION), balances);

                  const actual = await mock.fromLowResLog(logSpotPrice);
                  const expected = calculateSpotPrice(amp, balances);
                  expectEqualWithError(actual, expected, MAX_RELATIVE_ERROR);
                }
              });
            });
          }
        });
      }
    }
  });

  describe('BPT price', () => {
    context('with low BPT supply', () => {
      const bptSupply = bn(1e18);
      itComputesBptPriceGivenSupply(bptSupply);
    });

    context('with medium BPT supply', () => {
      const bptSupply = bn(1e25);
      itComputesBptPriceGivenSupply(bptSupply);
    });

    context('with large BPT supply', () => {
      const bptSupply = bn(1e32);
      itComputesBptPriceGivenSupply(bptSupply);
    });

    function itComputesBptPriceGivenSupply(bptSupply: BigNumber) {
      context('with low amp', () => {
        const amp = bn(200);
        itComputesBptPriceWithError(amp);
      });

      context('with mid amp', () => {
        const amp = bn(2000);
        itComputesBptPriceWithError(amp);
      });

      context('with high amp', () => {
        const amp = bn(5000);
        itComputesBptPriceWithError(amp);
      });

      function itComputesBptPriceWithError(amp: BigNumber) {
        const minPower = 18;
        const maxPower = 23;

        for (const power of range(minPower, maxPower)) {
          context(`with balances powers of ${power}`, () => {
            for (const delta of DELTAS) {
              context(`with deltas of magnitude ${delta}`, () => {
                it('computes log spot price with bounded relative error', async () => {
                  for (const balances of balancesOfMagnitude(power, delta)) {
                    const logBPTSupply = await mock.toLowResLog(bptSupply);
                    const logBptPrice = await mock.calcLogBptPrice(amp.mul(AMP_PRECISION), balances, logBPTSupply);

                    const actual = await mock.fromLowResLog(logBptPrice);
                    const expected = calculateBptPrice(amp, balances, bptSupply);

                    // BPT supply calculation has twice as much error as the others because it sums errors
                    expectEqualWithError(actual, expected, MAX_RELATIVE_ERROR * 2);
                  }
                });
              });
            }
          });
        }
      }
    }
  });
});
