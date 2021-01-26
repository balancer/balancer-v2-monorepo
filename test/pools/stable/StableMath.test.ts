import { Contract } from 'ethers';
import { Decimal } from 'decimal.js';

import { deploy } from '../../../lib/helpers/deploy';
import { calcInGivenOut, calcOutGivenIn } from '../../helpers/math/stable';
import { expectRelativeError } from '../../helpers/relativeError';

const MAX_RELATIVE_ERROR = 0.1; //Max relative error

async function compareOutGivenIn(
  mock: Contract,
  amp: string,
  balances: string[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountIn: string
) {
  const outAmountMath = calcOutGivenIn(
    new Decimal(amp).div((1e18).toString()),
    balances.map((v) => new Decimal(v).div((1e18).toString())),
    tokenIndexIn,
    tokenIndexOut,
    new Decimal(tokenAmountIn).div((1e18).toString())
  );
  const outAmountPool = await mock.outGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountIn);

  //TODO: work math for this to always happen?
  //Amount out calcuated by Pool  must be never greater than exact math
  // expect(
  //   outAmountMath.greaterThanOrEqualTo(outAmountPool.toString()),
  //   'Calculated amount out must be less or equal than exact'
  // ).to.be.true;

  //Relative error must be less that the max accepted
  expectRelativeError(
    outAmountMath.times((1e18).toString()),
    new Decimal(outAmountPool.toString()),
    new Decimal(MAX_RELATIVE_ERROR)
  );
}

async function compareInGivenOut(
  mock: Contract,
  amp: string,
  balances: string[],
  tokenIndexIn: number,
  tokenIndexOut: number,
  tokenAmountOut: string
) {
  const inAmountMath = calcInGivenOut(
    new Decimal(amp).div((1e18).toString()),
    balances.map((v) => new Decimal(v).div((1e18).toString())),
    tokenIndexIn,
    tokenIndexOut,
    new Decimal(tokenAmountOut).div((1e18).toString())
  );
  const inAmountPool = await mock.inGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountOut);

  //TODO: work math for this to always happen?
  //Amount in calcuated by Pool must be never lower than exact math
  // expect(
  //   inAmountMath.lessThanOrEqualTo(inAmountPool.toString()),
  //  'Calculated amount in must be greater or equal than exact'
  // ).to.be.true;

  //Relative error must be less that the max accepted
  expectRelativeError(
    inAmountMath.times((1e18).toString()),
    new Decimal(inAmountPool.toString()),
    new Decimal(MAX_RELATIVE_ERROR)
  );
}

describe.skip('StableMath', function () {
  let mock: Contract;

  beforeEach(async function () {
    mock = await deploy('MockStableMath', { args: [] });
  });

  describe('Simple swap', () => {
    it('outGivenIn', async () => {
      await compareOutGivenIn(
        mock,
        (7.6e18).toString(), //amp
        [(108.6e18).toString(), (42.482e18).toString()], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (4.14e18).toString() //tokenAmountIn
      );
    });
    it('inGivenOut', async () => {
      await compareInGivenOut(
        mock,
        (7.6e18).toString(), //amp
        [(108.6e18).toString(), (42.482e18).toString()], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (3.7928e18).toString() //tokenAmountOut
      );
    });
  });

  describe('Extreme amounts', () => {
    it('outGivenIn - min amount in', async () => {
      await compareOutGivenIn(
        mock,
        (7.6e18).toString(), //amp
        [(108.6e18).toString(), (42.482e18).toString()], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (10e9).toString() //tokenAmountIn (MIN AMOUNT = 0.00000001)
      );
    });
    it('inGivenOut - min amount out', async () => {
      await compareInGivenOut(
        mock,
        (7.6e18).toString(), //amp
        [(108.6e18).toString(), (42.482e18).toString()], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (10e9).toString() //tokenAmountIn (MIN AMOUNT = 0.00000001)
      );
    });
  });

  describe('Many tokens', () => {
    //NOTE: the more tokens, the more the invariant error
    it('outGivenIn', async () => {
      await compareOutGivenIn(
        mock,
        (7.6e18).toString(), //amp
        [
          (108.6e18).toString(),
          (42.482e18).toString(),
          (50e18).toString(),
          (60e18).toString(),
          (70e18).toString(),
          (80e18).toString(),
        ], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (4.14e18).toString() //tokenAmountIn
      );
    });
    //NOTE: the more tokens, the more the invariant error
    it('inGivenOut', async () => {
      await compareInGivenOut(
        mock,
        (7.6e18).toString(), //amp
        [
          (108.6e18).toString(),
          (42.482e18).toString(),
          (50e18).toString(),
          (60e18).toString(),
          (70e18).toString(),
          (80e18).toString(),
        ], //balances
        0, //tokenIndexIn
        1, //tokenIndexOut
        (6.108e18).toString() //tokenAmountOut
      );
    });
  });
});
