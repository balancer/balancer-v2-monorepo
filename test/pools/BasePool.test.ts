import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../helpers/expectEvent';
import TokenList from '../helpers/models/tokens/TokenList';
import { MONTH } from '../../lib/helpers/time';
import { roleId } from '../../lib/helpers/roles';
import { deploy } from '../../lib/helpers/deploy';
import { GeneralPool } from '../../lib/helpers/pools';
import { BigNumberish, fp } from '../../lib/helpers/numbers';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';
import { Account } from '../helpers/models/types/types';
import TypesConverter from '../helpers/models/types/TypesConverter';

describe('BasePool', function () {
  let admin: SignerWithAddress, poolOwner: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const WHERE = ZERO_ADDRESS;

  const MIN_SWAP_FEE = fp(0.000001);
  const MAX_SWAP_FEE = fp(0.1);

  before(async () => {
    [, admin, poolOwner, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
  });

  function deployBasePool(
    params: {
      tokens?: TokenList | string[];
      swapFee?: BigNumberish;
      responseWindowDuration?: number;
      bufferPeriodDuration?: number;
      owner?: Account;
    } = {}
  ): Promise<Contract> {
    let { tokens: poolTokens, swapFee, responseWindowDuration, bufferPeriodDuration, owner } = params;
    if (!poolTokens) poolTokens = tokens;
    if (!swapFee) swapFee = MIN_SWAP_FEE;
    if (!responseWindowDuration) responseWindowDuration = 0;
    if (!bufferPeriodDuration) bufferPeriodDuration = 0;
    if (!owner) owner = ZERO_ADDRESS;

    return deploy('MockBasePool', {
      args: [
        vault.address,
        GeneralPool,
        'Balancer Pool Token',
        'BPT',
        Array.isArray(poolTokens) ? poolTokens : poolTokens.addresses,
        swapFee,
        responseWindowDuration,
        bufferPeriodDuration,
        TypesConverter.toAddress(owner),
      ],
    });
  }

  describe('deployment', () => {
    it('registers a pool in the vault', async () => {
      const pool = await deployBasePool({ tokens });
      const poolId = await pool.getPoolId();

      const [poolAddress, poolSpecialization] = await vault.getPool(poolId);
      expect(poolAddress).to.equal(pool.address);
      expect(poolSpecialization).to.equal(GeneralPool);
    });

    it('reverts if the tokens are not sorted', async () => {
      await expect(deployBasePool({ tokens: tokens.addresses.reverse() })).to.be.revertedWith('UNSORTED_ARRAY');
    });
  });

  describe('authorizer', () => {
    let pool: Contract;

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployBasePool();
    });

    it('uses the authorizer of the vault', async () => {
      expect(await pool.getAuthorizer()).to.equal(authorizer.address);
    });

    it('tracks authorizer changes in the vault', async () => {
      const role = roleId(vault, 'changeAuthorizer');
      await authorizer.connect(admin).grantRole(role, admin.address);

      await vault.connect(admin).changeAuthorizer(other.address);

      expect(await pool.getAuthorizer()).to.equal(other.address);
    });
  });

  describe('swap fee', () => {
    context('initialization', () => {
      it('has an initial swap fee', async () => {
        const swapFee = fp(0.003);
        const pool = await deployBasePool({ swapFee });

        expect(await pool.getSwapFeePercentage()).to.equal(swapFee);
      });
    });

    context('set swap fee', () => {
      let pool: Contract;
      let sender: SignerWithAddress;

      function itSetsSwapFee() {
        context('when the new swap fee is within bounds', () => {
          const newSwapFee = MAX_SWAP_FEE.sub(1);

          it('can change the swap fee', async () => {
            await pool.connect(sender).setSwapFeePercentage(newSwapFee);

            expect(await pool.getSwapFeePercentage()).to.equal(newSwapFee);
          });

          it('emits an event', async () => {
            const receipt = await (await pool.connect(sender).setSwapFeePercentage(newSwapFee)).wait();

            expectEvent.inReceipt(receipt, 'SwapFeeChanged', { swapFeePercentage: newSwapFee });
          });
        });

        context('when the new swap fee is above the maximum', () => {
          const swapFee = MAX_SWAP_FEE.add(1);

          it('reverts', async () => {
            await expect(pool.connect(sender).setSwapFeePercentage(swapFee)).to.be.revertedWith('MAX_SWAP_FEE');
          });
        });

        context('when the new swap fee is below the minimum', () => {
          const swapFee = MIN_SWAP_FEE.sub(1);

          it('reverts', async () => {
            await expect(pool.connect(sender).setSwapFeePercentage(swapFee)).to.be.revertedWith('MIN_SWAP_FEE');
          });
        });
      }

      function itRevertsWithUnallowedSender() {
        it('reverts', async () => {
          await expect(pool.connect(sender).setSwapFeePercentage(MIN_SWAP_FEE)).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      }

      context('with no owner', () => {
        const owner = ZERO_ADDRESS;

        sharedBeforeEach('deploy pool', async () => {
          pool = await deployBasePool({ swapFee: fp(0.01), owner });
        });

        context('when the sender has a set fee role in the authorizer', () => {
          sharedBeforeEach('grant permission', async () => {
            const role = roleId(pool, 'setSwapFeePercentage');
            await authorizer.connect(admin).grantRole(role, admin.address);
            sender = admin;
          });

          itSetsSwapFee();
        });

        context('when the sender does not have the set fee role in the authorizer', () => {
          itRevertsWithUnallowedSender();
        });
      });

      context('with an owner', () => {
        let owner: SignerWithAddress;

        sharedBeforeEach('deploy pool', async () => {
          owner = poolOwner;
          pool = await deployBasePool({ swapFee: fp(0.01), owner });
        });

        context('when the sender is the owner', () => {
          beforeEach(() => {
            sender = owner;
          });

          itSetsSwapFee();
        });

        context('when the sender is not the owner', () => {
          beforeEach(() => {
            sender = other;
          });

          context('when the sender does not have the set fee role in the authorizer', () => {
            itRevertsWithUnallowedSender();
          });

          context('when the sender has the set fee role in the authorizer', () => {
            sharedBeforeEach(async () => {
              const role = roleId(pool, 'setSwapFeePercentage');
              await authorizer.connect(admin).grantRole(role, sender.address);
            });

            itRevertsWithUnallowedSender();
          });
        });
      });
    });
  });

  describe('temporarily pausable', () => {
    let pool: Contract;
    const RESPONSE_WINDOW_DURATION = MONTH * 3;
    const BUFFER_PERIOD_DURATION = MONTH;

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployBasePool({
        responseWindowDuration: RESPONSE_WINDOW_DURATION,
        bufferPeriodDuration: BUFFER_PERIOD_DURATION,
      });
    });

    context('when the sender is has the role to pause and unpause in the authorizer', () => {
      let role: string;

      sharedBeforeEach('grant permission', async () => {
        role = roleId(pool, 'setPaused');
        await authorizer.connect(admin).grantRole(role, admin.address);
      });

      it('can pause', async () => {
        await pool.connect(admin).setPaused(true);

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.true;
      });

      it('can unpause', async () => {
        await pool.connect(admin).setPaused(true);
        await pool.connect(admin).setPaused(false);

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.false;
      });

      it('cannot pause if the role is revoked in the authorizer', async () => {
        await authorizer.connect(admin).revokeRole(role, admin.address);
        expect(await authorizer.hasRoleIn(role, admin.address, WHERE)).to.be.false;

        await expect(pool.connect(admin).setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the role to pause in the authorizer', () => {
      it('reverts', async () => {
        await expect(pool.connect(other).setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
