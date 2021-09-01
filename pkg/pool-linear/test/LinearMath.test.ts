import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describe('LinearMath', function () {
  let math: Contract;

  const EXPECTED_RELATIVE_ERROR = 1e-16;

  const params = {
    fee: fp(0.01),
    rate: fp(1),
    lowerTarget: fp(1000),
    upperTarget: fp(2000),
  };

  before('deploy math mock', async function () {
    math = await deploy('MockLinearMath');
  });

  describe('init', () => {
    it('given main in', async () => {
      params.rate = fp(1);
      const mainIn = fp(1);
      const mainBalance = fp(0);
      const wrappedBalance = fp(0);
      const bptSupply = fp(0);

      const bptIn = await math.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);
      expect(bptIn).to.be.equalWithError(fp(1.010101010101010101), EXPECTED_RELATIVE_ERROR);
    });

    it('given BPT out', async () => {
      params.rate = fp(1);
      const bptOut = fp(1.010101010101010102);
      const mainBalance = fp(0);
      const wrappedBalance = fp(0);
      const bptSupply = fp(0);

      const mainIn = await math.calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
      expect(mainBalance.add(mainIn)).to.be.equalWithError(fp(1), EXPECTED_RELATIVE_ERROR);
    });
  });

  describe('join', () => {
    it('given main in', async () => {
      params.rate = fp(1);
      const mainIn = fp(100);
      const mainBalance = fp(1);
      const wrappedBalance = fp(0);
      const bptSupply = fp(1.010101010101010101);

      const bptOut = await math.calcBptOutPerMainIn(mainIn, mainBalance, wrappedBalance, bptSupply, params);
      expect(bptSupply.add(bptOut)).to.be.equalWithError(fp(102.020202020202020202), EXPECTED_RELATIVE_ERROR);
    });

    it('given BPT out', async () => {
      params.rate = fp(1.3);
      const bptOut = fp(100);
      const mainBalance = fp(455.990803937038319103);
      const wrappedBalance = fp(138.463846384639);
      const bptSupply = fp(704.587755444953);

      const mainIn = await math.calcMainInPerBptOut(bptOut, mainBalance, wrappedBalance, bptSupply, params);
      expect(mainBalance.add(mainIn)).to.be.equalWithError(fp(546), EXPECTED_RELATIVE_ERROR);
    });
  });

  describe('exit', () => {
    it('given BPT in', async () => {
      params.rate = fp(1.3);
      const bptIn = fp(100);
      const mainBalance = fp(546);
      const wrappedBalance = fp(138.463846384639);
      const bptSupply = fp(804.587755444953);

      const mainOut = await math.calcMainOutPerBptIn(bptIn, mainBalance, wrappedBalance, bptSupply, params);
      expect(mainBalance.sub(mainOut)).to.be.equalWithError(fp(455.990803937038319103), EXPECTED_RELATIVE_ERROR);
    });

    it('given main out', async () => {
      params.rate = fp(1);
      const mainOut = fp(50);
      const mainBalance = fp(101);
      const wrappedBalance = fp(0);
      const bptSupply = fp(102.020202020202020202);

      const bptIn = await math.calcBptInPerMainOut(mainOut, mainBalance, wrappedBalance, bptSupply, params);
      expect(bptSupply.sub(bptIn)).to.be.equalWithError(fp(51.515151515151515151), EXPECTED_RELATIVE_ERROR);
    });
  });

  describe('swap', () => {
    it('given main out', async () => {
      params.rate = fp(1);
      const mainOut = fp(10);
      const mainBalance = fp(51);
      const wrappedBalance = fp(0);

      const wrappedIn = await math.calcWrappedInPerMainOut(mainOut, mainBalance, wrappedBalance, params);
      expect(wrappedBalance.add(wrappedIn)).to.be.equalWithError(fp(10.10101010101010101), EXPECTED_RELATIVE_ERROR);
    });

    it('given main in', async () => {
      params.rate = fp(1);
      const mainIn = fp(5);
      const mainBalance = fp(41);
      const wrappedBalance = fp(10.10101010101010101);

      const wrappedOut = await math.calcWrappedOutPerMainIn(mainIn, mainBalance, wrappedBalance, params);
      expect(wrappedBalance.sub(wrappedOut)).to.be.equalWithError(fp(5.050505050505050505), EXPECTED_RELATIVE_ERROR);
    });

    it('given wrapped out', async () => {
      params.rate = fp(1.3);
      const wrappedOut = fp(900);
      const mainBalance = fp(931.695980314809);

      const mainIn = await math.calcMainInPerWrappedOut(wrappedOut, mainBalance, params);
      expect(mainBalance.add(mainIn)).to.be.equalWithError(fp(2102.21812133126978788), EXPECTED_RELATIVE_ERROR);
    });

    it('given wrapped in', async () => {
      params.rate = fp(1.3);
      const wrappedIn = fp(50);
      const mainBalance = fp(996.10705082304);

      const mainOut = await math.calcMainOutPerWrappedIn(wrappedIn, mainBalance, params);
      expect(mainBalance.sub(mainOut)).to.be.equalWithError(fp(931.6959803148096), EXPECTED_RELATIVE_ERROR);
    });
  });
});
