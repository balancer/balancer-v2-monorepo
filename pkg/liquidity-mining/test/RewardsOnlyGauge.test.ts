import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256 as MAX_DEADLINE, MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { signPermit } from '@balancer-labs/balancer-js';
import { advanceTime, currentTimestamp, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { parseFixed } from '@ethersproject/bignumber';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

describe('RewardsOnlyGauge', () => {
  let vault: Vault;
  let adaptor: Contract;

  let token: Token;
  let balToken: Token;

  let gauge: Contract;
  let streamer: Contract;

  let admin: SignerWithAddress,
    distributor: SignerWithAddress,
    holder: SignerWithAddress,
    spender: SignerWithAddress,
    other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, distributor, holder, spender, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token', async () => {
    vault = await Vault.create({ admin });
    if (!vault.authorizer) throw Error('Vault has no Authorizer');

    adaptor = await deploy('AuthorizerAdaptor', { args: [vault.address] });

    token = await Token.create({ symbol: 'BPT' });
    balToken = await Token.create({ symbol: 'BAL' });

    const gaugeImplementation = await deploy('RewardsOnlyGauge', {
      args: [balToken.address, vault.address, adaptor.address],
    });
    const streamerImplementation = await deploy('ChildChainStreamer', { args: [balToken.address, adaptor.address] });

    const factory = await deploy('ChildChainLiquidityGaugeFactory', {
      args: [gaugeImplementation.address, streamerImplementation.address],
    });

    await factory.create(token.address);

    gauge = await deployedAt('RewardsOnlyGauge', await factory.getPoolGauge(token.address));
    streamer = await deployedAt('ChildChainStreamer', await factory.getPoolStreamer(token.address));
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

  describe('claim_rewards', () => {
    const rewardAmount = parseFixed('1', 18);

    sharedBeforeEach('stake into gauge', async () => {
      await token.mint(holder);
      await token.approve(gauge, MAX_UINT256, { from: holder });

      await gauge.connect(holder)['deposit(uint256)'](rewardAmount);
      await gauge.connect(holder)['deposit(uint256,address)'](rewardAmount.mul(2), other.address);
    });

    sharedBeforeEach('set up distributor on streamer', async () => {
      const setDistributorActionId = await actionId(adaptor, 'set_reward_distributor', streamer.interface);
      await vault.grantPermissionsGlobally([setDistributorActionId], admin);

      const calldata = streamer.interface.encodeFunctionData('set_reward_distributor', [
        balToken.address,
        distributor.address,
      ]);
      await adaptor.connect(admin).performAction(streamer.address, calldata);
    });

    sharedBeforeEach('send tokens to streamer', async () => {
      await balToken.mint(streamer.address, rewardAmount);
      await streamer.connect(distributor).notify_reward_amount(balToken.address);
    });

    context('during reward period', () => {
      sharedBeforeEach('start reward period', async () => {
        await advanceTime(DAY);
      });

      it('transfers the expected number of tokens', async () => {
        const expectedClaimAmount = rewardAmount.mul(DAY).div(WEEK).div(3);
        await expectBalanceChange(() => gauge.connect(holder)['claim_rewards()'](), new TokenList([balToken]), [
          { account: holder, changes: { BAL: ['near', expectedClaimAmount] } },
        ]);
      });
    });

    context('after reward period', () => {
      sharedBeforeEach('start reward period', async () => {
        await advanceTime(WEEK);
      });

      it('transfers the expected number of tokens', async () => {
        // We need to account for rounding errors for rewards per second
        const expectedClaimAmount = rewardAmount.div(WEEK).mul(WEEK).div(3);
        await expectBalanceChange(() => gauge.connect(holder)['claim_rewards()'](), new TokenList([balToken]), [
          { account: holder, changes: { BAL: expectedClaimAmount } },
        ]);
      });
    });
  });
});
