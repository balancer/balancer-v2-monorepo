import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { ANY_ADDRESS, MAX_UINT256 as MAX_DEADLINE } from '@balancer-labs/v2-helpers/src/constants';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { signPermit } from '@balancer-labs/balancer-js';
import { currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

describe('RewardsOnlyGauge', () => {
  let token: Token;
  let gauge: Contract;

  let holder: SignerWithAddress, spender: SignerWithAddress;

  before('setup signers', async () => {
    [, holder, spender] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token', async () => {
    token = await Token.create({ symbol: 'BPT' });
    const gaugeImplementation = await deploy('RewardsOnlyGauge', { args: [ANY_ADDRESS, ANY_ADDRESS, ANY_ADDRESS] });
    const streamerImplementation = await deploy('ChildChainStreamer', { args: [ANY_ADDRESS, ANY_ADDRESS] });

    const factory = await deploy('ChildChainLiquidityGaugeFactory', {
      args: [gaugeImplementation.address, streamerImplementation.address],
    });

    const tx = await factory.create(token.address);
    const event = expectEvent.inReceipt(await tx.wait(), 'RewardsOnlyGaugeCreated');
    gauge = await deployedAt('RewardsOnlyGauge', event.args.gauge);
  });

  describe('info', () => {
    it('setups the name properly', async () => {
      expect(await gauge.name()).to.be.equal(`Balancer ${token.symbol} RewardGauge Deposit`);
    });
  });

  describe('permit', () => {
    it('initial nonce is zero', async () => {
      expect(await gauge.nonces(holder.address)).to.equal(0);
    });

    const amount = bn(42);

    it('accepts holder signature', async function () {
      const previousNonce = await gauge.nonces(holder.address);
      const { v, r, s } = await signPermit(gauge, holder, spender, amount);

      const receipt = await (await gauge.permit(holder.address, spender.address, amount, MAX_DEADLINE, v, r, s)).wait();
      expectEvent.inReceipt(receipt, 'Approval', { _owner: holder.address, _spender: spender.address, _value: amount });

      expect(await gauge.nonces(holder.address)).to.equal(previousNonce.add(1));
      expect(await gauge.allowance(holder.address, spender.address)).to.equal(amount);
    });

    context('with invalid signature', () => {
      let v: number, r: string, s: string, deadline: BigNumber;

      context('with reused signature', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(gauge, holder, spender, amount));
          await gauge.permit(holder.address, spender.address, amount, deadline, v, r, s);
        });

        itReverts();
      });

      context('with signature for other holder', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(gauge, spender, spender, amount));
        });

        itReverts();
      });

      context('with signature for other spender', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(gauge, holder, holder, amount));
        });

        itReverts();
      });

      context('with signature for other amount', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(gauge, holder, spender, amount.add(1)));
        });

        itReverts();
      });

      context('with signature for other token', () => {
        beforeEach(async () => {
          const otherToken = await Token.create('TKN');

          ({ v, r, s, deadline } = await signPermit(otherToken.instance, holder, spender, amount));
        });

        itReverts();
      });

      context('with signature with invalid nonce', () => {
        beforeEach(async () => {
          const currentNonce = await gauge.nonces(holder.address);
          ({ v, r, s, deadline } = await signPermit(gauge, holder, spender, amount, MAX_DEADLINE, currentNonce.add(1)));
        });

        itReverts();
      });

      context('with expired deadline', () => {
        beforeEach(async () => {
          const now = await currentTimestamp();

          ({ v, r, s, deadline } = await signPermit(gauge, holder, spender, amount, now.sub(1)));
        });

        itReverts();
      });

      function itReverts() {
        it('reverts', async () => {
          await expect(gauge.permit(holder.address, spender.address, amount, deadline, v, r, s)).to.be.reverted;
        });
      }
    });
  });
});
