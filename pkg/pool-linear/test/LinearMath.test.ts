import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp, bn, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

import * as math from './math';

describe('LinearMath', function () {
  let mathContract: Contract;

  const EXPECTED_RELATIVE_ERROR = 1e-14;

  before('deploy math mock', async function () {
    mathContract = await deploy('MockLinearMath');
  });

  describe('init', () => {
    const params = {
      fee: fp(0.01),
      lowerTarget: FP_ZERO,
      upperTarget: fp(200),
    };

    const mainBalance = FP_ZERO;
    const wrappedBalance = FP_ZERO;
    const bptSupply = FP_ZERO;

    it('given main in within lower and upper', async () => {
      const mainIn = fp(5);
      const expected = math.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);
      const bptIn = await mathContract.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);

      expect(bn(expected)).to.be.equal(fp(5));
      expect(bptIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
    });

    it('given main in over upper', async () => {
      const mainIn = fp(400);

      const expected = math.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);
      const bptIn = await mathContract.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);

      expect(bn(expected)).to.be.equal(fp(398));
      expect(bptIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
    });
  });

  const params = {
    fee: fp(0.01),
    lowerTarget: fp(100),
    upperTarget: fp(200),
  };

  context('with main below lower', () => {
    const mainBalance = fp(35);
    const wrappedBalance = fp(15.15);
    const bptSupply = fp(49.5);

    context('swap bpt & main', () => {
      context('main in', () => {
        it('given main in', async () => {
          const mainIn = fp(100);

          const expected = math.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);
          const bptOut = await mathContract.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(100.65));
          expect(bptOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given BPT out', async () => {
          const bptOut = fp(100.65);

          const expected = math.calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
          const mainIn = await mathContract.calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(100));
          expect(mainIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });

      context('main out', () => {
        it('given BPT in', async () => {
          const bptIn = fp(10.1);

          const expected = math.calcMainOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
          const mainOut = await mathContract.calcMainOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(10));
          expect(mainOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given main out', async () => {
          const mainOut = fp(10);

          const expected = math.calcBptInPerMainOut(mainOut, mainBalance, wrappedBalance, bptSupply, params);
          const bptIn = await mathContract.calcBptInPerMainOut(mainOut, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(10.1));
          expect(bptIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });
    });

    describe('swap main & wrapped', () => {
      context('main in', () => {
        it('given main in', async () => {
          const mainIn = fp(10);

          const expected = math.calcWrappedOutPerMainIn(mainIn, mainBalance, params);
          const wrappedOut = await mathContract.calcWrappedOutPerMainIn(mainIn, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(10.1));
          expect(wrappedOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given wrapped out', async () => {
          const wrappedOut = fp(10.1);

          const expected = math.calcMainInPerWrappedOut(wrappedOut, mainBalance, params);
          const mainIn = await mathContract.calcMainInPerWrappedOut(wrappedOut, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(10));
          expect(mainIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });

      context('main out', () => {
        it('given main out', async () => {
          const mainOut = fp(10);

          const expected = math.calcWrappedInPerMainOut(mainOut, mainBalance, params);
          const wrappedIn = await mathContract.calcWrappedInPerMainOut(mainOut, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(10.1));
          expect(wrappedIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given wrapped in', async () => {
          const wrappedIn = fp(10.1);

          const expected = math.calcMainOutPerWrappedIn(wrappedIn, mainBalance, params);
          const mainOut = await mathContract.calcMainOutPerWrappedIn(wrappedIn, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(10));
          expect(mainOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });
    });

    describe('swap bpt & wrapped', () => {
      it('given wrapped in', async () => {
        const wrappedIn = fp(5);

        const expected = math.calcBptOutPerWrappedIn(wrappedIn, mainBalance, wrappedBalance, bptSupply, params);
        const bptOut = await mathContract.calcBptOutPerWrappedIn(
          wrappedIn,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(bptOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given BPT out', async () => {
        const bptOut = fp(5);

        const expected = math.calcWrappedInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
        const wrappedIn = await mathContract.calcWrappedInPerBptOut(
          bptOut,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(wrappedIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given BPT in', async () => {
        const bptIn = fp(5);

        const expected = math.calcWrappedOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
        const wrappedOut = await mathContract.calcWrappedOutPerBptIn(
          bptIn,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(wrappedOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given wrapped out', async () => {
        const wrappedOut = fp(5);

        const expected = math.calcBptInPerWrappedOut(wrappedOut, mainBalance, wrappedBalance, bptSupply, params);
        const bptIn = await mathContract.calcBptInPerWrappedOut(
          wrappedOut,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(bptIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });
    });
  });

  context('with main within lower and upper', () => {
    const mainBalance = fp(130);
    const wrappedBalance = fp(20);
    const bptSupply = fp(150);

    context('swap bpt & main', () => {
      context('main in', () => {
        it('given main in', async () => {
          const mainIn = fp(100);

          const expected = math.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);
          const bptOut = await mathContract.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(99.7));
          expect(bptOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given BPT out', async () => {
          const bptOut = fp(99.7);

          const expected = math.calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
          const mainIn = await mathContract.calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(100));
          expect(mainIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });

      context('main out', () => {
        it('given BPT in', async () => {
          const bptIn = fp(100.7);

          const expected = math.calcMainOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
          const mainOut = await mathContract.calcMainOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(100));
          expect(mainOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given main out', async () => {
          const mainOut = fp(100);

          const expected = math.calcBptInPerMainOut(mainOut, mainBalance, wrappedBalance, bptSupply, params);
          const bptIn = await mathContract.calcBptInPerMainOut(mainOut, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(100.7));
          expect(bptIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });
    });

    describe('swap main & wrapped', () => {
      context('main in', () => {
        it('given main in', async () => {
          const mainIn = fp(20);

          const expected = math.calcWrappedOutPerMainIn(mainIn, mainBalance, params);
          const wrappedOut = await mathContract.calcWrappedOutPerMainIn(mainIn, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(20));
          expect(wrappedOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given wrapped out', async () => {
          const wrappedOut = fp(20);

          const expected = math.calcMainInPerWrappedOut(wrappedOut, mainBalance, params);
          const mainIn = await mathContract.calcMainInPerWrappedOut(wrappedOut, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(20));
          expect(mainIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });

      context('main out', () => {
        it('given main out', async () => {
          const mainOut = fp(20);

          const expected = math.calcWrappedInPerMainOut(mainOut, mainBalance, params);
          const wrappedIn = await mathContract.calcWrappedInPerMainOut(mainOut, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(20));
          expect(wrappedIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given wrapped in', async () => {
          const wrappedIn = fp(20);

          const expected = math.calcMainOutPerWrappedIn(wrappedIn, mainBalance, params);
          const mainOut = await mathContract.calcMainOutPerWrappedIn(wrappedIn, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(20));
          expect(mainOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });
    });

    describe('swap bpt & wrapped', () => {
      it('given wrapped in', async () => {
        const wrappedIn = fp(5);

        const expected = math.calcBptOutPerWrappedIn(wrappedIn, mainBalance, wrappedBalance, bptSupply, params);
        const bptOut = await mathContract.calcBptOutPerWrappedIn(
          wrappedIn,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(bptOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given BPT out', async () => {
        const bptOut = fp(5);

        const expected = math.calcWrappedInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
        const wrappedIn = await mathContract.calcWrappedInPerBptOut(
          bptOut,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(wrappedIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given BPT in', async () => {
        const bptIn = fp(5);

        const expected = math.calcWrappedOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
        const wrappedOut = await mathContract.calcWrappedOutPerBptIn(
          bptIn,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(wrappedOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given wrapped out', async () => {
        const wrappedOut = fp(5);

        const expected = math.calcBptInPerWrappedOut(wrappedOut, mainBalance, wrappedBalance, bptSupply, params);
        const bptIn = await mathContract.calcBptInPerWrappedOut(
          wrappedOut,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(bptIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });
    });
  });

  context('with main above upper', () => {
    const mainBalance = fp(240);
    const wrappedBalance = fp(59.4);
    const bptSupply = fp(299);

    context('swap bpt & main', () => {
      context('main in', () => {
        it('given main in', async () => {
          const mainIn = fp(100);

          const expected = math.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);
          const bptOut = await mathContract.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(99));
          expect(bptOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given BPT out', async () => {
          const bptOut = fp(99);

          const expected = math.calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
          const mainIn = await mathContract.calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(100));
          expect(mainIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });

      context('main out', () => {
        it('given BPT in', async () => {
          const bptIn = fp(99.6);

          const expected = math.calcMainOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
          const mainOut = await mathContract.calcMainOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(100));
          expect(mainOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given main out', async () => {
          const mainOut = fp(100);

          const expected = math.calcBptInPerMainOut(mainOut, mainBalance, wrappedBalance, bptSupply, params);
          const bptIn = await mathContract.calcBptInPerMainOut(mainOut, mainBalance, wrappedBalance, bptSupply, params);

          expect(bn(expected)).to.be.equal(fp(99.6));
          expect(bptIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });
    });

    describe('swap main & wrapped', () => {
      context('main in', () => {
        it('given main in', async () => {
          const mainIn = fp(50);

          const expected = math.calcWrappedOutPerMainIn(mainIn, mainBalance, params);
          const wrappedOut = await mathContract.calcWrappedOutPerMainIn(mainIn, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(49.5));
          expect(wrappedOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given wrapped out', async () => {
          const wrappedOut = fp(49.5);

          const expected = math.calcMainInPerWrappedOut(wrappedOut, mainBalance, params);
          const mainIn = await mathContract.calcMainInPerWrappedOut(wrappedOut, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(50));
          expect(mainIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });

      context('main out', () => {
        it('given main out', async () => {
          const mainOut = fp(55);

          const expected = math.calcWrappedInPerMainOut(mainOut, mainBalance, params);
          const wrappedIn = await mathContract.calcWrappedInPerMainOut(mainOut, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(54.6));
          expect(wrappedIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });

        it('given wrapped in', async () => {
          const wrappedIn = fp(54.6);

          const expected = math.calcMainOutPerWrappedIn(wrappedIn, mainBalance, params);
          const mainOut = await mathContract.calcMainOutPerWrappedIn(wrappedIn, mainBalance, params);

          expect(bn(expected)).to.be.equal(fp(55));
          expect(mainOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
        });
      });
    });

    describe('swap bpt & wrapped', () => {
      it('given wrapped in', async () => {
        const wrappedIn = fp(5);

        const expected = math.calcBptOutPerWrappedIn(wrappedIn, mainBalance, wrappedBalance, bptSupply, params);
        const bptOut = await mathContract.calcBptOutPerWrappedIn(
          wrappedIn,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(bptOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given BPT out', async () => {
        const bptOut = fp(5);

        const expected = math.calcWrappedInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
        const wrappedIn = await mathContract.calcWrappedInPerBptOut(
          bptOut,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(wrappedIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given BPT in', async () => {
        const bptIn = fp(5);

        const expected = math.calcWrappedOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
        const wrappedOut = await mathContract.calcWrappedOutPerBptIn(
          bptIn,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(wrappedOut).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });

      it('given wrapped out', async () => {
        const wrappedOut = fp(5);

        const expected = math.calcBptInPerWrappedOut(wrappedOut, mainBalance, wrappedBalance, bptSupply, params);
        const bptIn = await mathContract.calcBptInPerWrappedOut(
          wrappedOut,
          mainBalance,
          wrappedBalance,
          bptSupply,
          params
        );

        expect(bn(expected)).to.be.equal(fp(5));
        expect(bptIn).to.be.equalWithError(bn(expected), EXPECTED_RELATIVE_ERROR);
      });
    });
  });
});
