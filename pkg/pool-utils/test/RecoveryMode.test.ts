import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';

describe('RecoveryMode', function () {
  let owner: SignerWithAddress;
  let mock: Contract;

  before(async () => {
    [, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy mock', async () => {
    mock = await deploy('MockRecoveryMode', { args: [owner.address] });
  });

  describe('amounts out', () => {
    const TOTAL_SUPPLY = fp(100_000);
    const BALANCES = [fp(10_000), fp(5_000), fp(1_000), fp(2_000 / 3)];

    it('returns no tokens if bptAmountIn is zero', async () => {
      const amountsOut = await mock.computeProportionalAmountsOut(BALANCES, TOTAL_SUPPLY, 0);

      expect(amountsOut).to.be.zeros;
    });

    it('returns everything if exiting with the total supply', async () => {
      const amountsOut = await mock.computeProportionalAmountsOut(BALANCES, TOTAL_SUPPLY, TOTAL_SUPPLY);

      expect(amountsOut).to.deep.equal(BALANCES);
    });

    it('reverts if total supply is zero', async () => {
      await expect(mock.computeProportionalAmountsOut(BALANCES, 0, 0)).to.be.revertedWith('ZERO_DIVISION');
    });

    for (let i = 0.05; i < 1; i += 0.05) {
      it(`returns correct balances at ${(i * 100).toFixed(0)}%`, async () => {
        const amountsOut = await mock.computeProportionalAmountsOut(BALANCES, TOTAL_SUPPLY, TOTAL_SUPPLY.mul(fp(i)));
        expect(amountsOut).to.deep.equal(BALANCES.map((b) => b.mul(fp(i))));
      });
    }

    context('rounding', () => {
      const BALANCES = [fp(2.0000000000000005), fp(50_000)];

      it('rounds amounts down', async () => {
        const amountsOut = await mock.computeProportionalAmountsOut(BALANCES, TOTAL_SUPPLY, TOTAL_SUPPLY.div(2));

        expect(amountsOut).to.deep.equal([fp(1.0000000000000002), fp(25_000)]);
      });
    });
  });
});
