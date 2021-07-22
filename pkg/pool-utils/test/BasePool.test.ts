import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { advanceTime, DAY, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';

describe('BasePool', function () {
  let admin: SignerWithAddress,
    poolOwner: SignerWithAddress,
    deployer: SignerWithAddress,
    assetManager: SignerWithAddress,
    other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const MIN_SWAP_FEE_PERCENTAGE = fp(0.000001);
  const MAX_SWAP_FEE_PERCENTAGE = fp(0.1);
  const DELEGATE_OWNER = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';

  before(async () => {
    [, admin, poolOwner, deployer, assetManager, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
  });

  function deployBasePool(
    params: {
      tokens?: TokenList | string[];
      assetManagers?: string[];
      swapFeePercentage?: BigNumberish;
      pauseWindowDuration?: number;
      bufferPeriodDuration?: number;
      owner?: Account;
      from?: SignerWithAddress;
    } = {}
  ): Promise<Contract> {
    let {
      tokens: poolTokens,
      assetManagers,
      swapFeePercentage,
      pauseWindowDuration,
      bufferPeriodDuration,
      owner,
    } = params;
    if (!poolTokens) poolTokens = tokens;
    if (!assetManagers) assetManagers = Array(poolTokens.length).fill(ZERO_ADDRESS);
    if (!swapFeePercentage) swapFeePercentage = MIN_SWAP_FEE_PERCENTAGE;
    if (!pauseWindowDuration) pauseWindowDuration = 0;
    if (!bufferPeriodDuration) bufferPeriodDuration = 0;
    if (!owner) owner = ZERO_ADDRESS;

    return deploy('MockBasePool', {
      from: params.from,
      args: [
        vault.address,
        PoolSpecialization.GeneralPool,
        'Balancer Pool Token',
        'BPT',
        Array.isArray(poolTokens) ? poolTokens : poolTokens.addresses,
        assetManagers,
        swapFeePercentage,
        pauseWindowDuration,
        bufferPeriodDuration,
        TypesConverter.toAddress(owner),
      ],
    });
  }

  describe('deployment', () => {
    let assetManagers: string[];

    beforeEach(() => {
      assetManagers = [assetManager.address, ...Array(tokens.length - 1).fill(ZERO_ADDRESS)];
    });

    it('registers a pool in the vault', async () => {
      const pool = await deployBasePool({
        tokens,
        assetManagers,
      });
      const poolId = await pool.getPoolId();

      const [poolAddress, poolSpecialization] = await vault.getPool(poolId);
      expect(poolAddress).to.equal(pool.address);
      expect(poolSpecialization).to.equal(PoolSpecialization.GeneralPool);

      const { tokens: poolTokens } = await vault.getPoolTokens(poolId);
      expect(poolTokens).to.have.same.members(tokens.addresses);

      poolTokens.forEach(async (token: string, i: number) => {
        const { assetManager } = await vault.getPoolTokenInfo(poolId, token);
        expect(assetManager).to.equal(assetManagers[i]);
      });
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
      const action = await actionId(vault, 'setAuthorizer');
      await authorizer.connect(admin).grantRole(action, admin.address);

      await vault.connect(admin).setAuthorizer(other.address);

      expect(await pool.getAuthorizer()).to.equal(other.address);
    });

    describe('action identifiers', () => {
      const selector = '0x12345678';

      context('with same pool creator', () => {
        it('pools share action identifiers', async () => {
          const pool = await deployBasePool({ tokens, from: deployer });
          const otherPool = await deployBasePool({ tokens, from: deployer });

          expect(await pool.getActionId(selector)).to.equal(await otherPool.getActionId(selector));
        });
      });

      context('with different pool creators', () => {
        it('pools have unique action identifiers', async () => {
          const pool = await deployBasePool({ tokens, from: deployer });
          const otherPool = await deployBasePool({ tokens, from: other });

          expect(await pool.getActionId(selector)).to.not.equal(await otherPool.getActionId(selector));
        });
      });
    });
  });

  describe('swap fee', () => {
    context('initialization', () => {
      it('has an initial swap fee', async () => {
        const swapFeePercentage = fp(0.003);
        const pool = await deployBasePool({ swapFeePercentage });

        expect(await pool.getSwapFeePercentage()).to.equal(swapFeePercentage);
      });
    });

    context('set swap fee percentage', () => {
      let pool: Contract;
      let sender: SignerWithAddress;

      function itSetsSwapFeePercentage() {
        context('when the new swap fee percentage is within bounds', () => {
          const newSwapFeePercentage = MAX_SWAP_FEE_PERCENTAGE.sub(1);

          it('can change the swap fee', async () => {
            await pool.connect(sender).setSwapFeePercentage(newSwapFeePercentage);

            expect(await pool.getSwapFeePercentage()).to.equal(newSwapFeePercentage);
          });

          it('emits an event', async () => {
            const receipt = await (await pool.connect(sender).setSwapFeePercentage(newSwapFeePercentage)).wait();

            expectEvent.inReceipt(receipt, 'SwapFeePercentageChanged', { swapFeePercentage: newSwapFeePercentage });
          });
        });

        context('when the new swap fee percentage is above the maximum', () => {
          const swapFeePercentage = MAX_SWAP_FEE_PERCENTAGE.add(1);

          it('reverts', async () => {
            await expect(pool.connect(sender).setSwapFeePercentage(swapFeePercentage)).to.be.revertedWith(
              'MAX_SWAP_FEE_PERCENTAGE'
            );
          });
        });

        context('when the new swap fee percentage is below the minimum', () => {
          const swapFeePercentage = MIN_SWAP_FEE_PERCENTAGE.sub(1);

          it('reverts', async () => {
            await expect(pool.connect(sender).setSwapFeePercentage(swapFeePercentage)).to.be.revertedWith(
              'MIN_SWAP_FEE_PERCENTAGE'
            );
          });
        });
      }

      function itRevertsWithUnallowedSender() {
        it('reverts', async () => {
          await expect(pool.connect(sender).setSwapFeePercentage(MIN_SWAP_FEE_PERCENTAGE)).to.be.revertedWith(
            'SENDER_NOT_ALLOWED'
          );
        });
      }

      context('with a delegated owner', () => {
        const owner = DELEGATE_OWNER;

        sharedBeforeEach('deploy pool', async () => {
          pool = await deployBasePool({ swapFeePercentage: fp(0.01), owner });
        });

        beforeEach('set sender', () => {
          sender = other;
        });

        context('when the sender has the set fee permission in the authorizer', () => {
          sharedBeforeEach('grant permission', async () => {
            const action = await actionId(pool, 'setSwapFeePercentage');
            await authorizer.connect(admin).grantRole(action, sender.address);
          });

          itSetsSwapFeePercentage();
        });

        context('when the sender does not have the set fee permission in the authorizer', () => {
          itRevertsWithUnallowedSender();
        });
      });

      context('with an owner', () => {
        let owner: SignerWithAddress;

        sharedBeforeEach('deploy pool', async () => {
          owner = poolOwner;
          pool = await deployBasePool({ swapFeePercentage: fp(0.01), owner });
        });

        context('when the sender is the owner', () => {
          beforeEach(() => {
            sender = owner;
          });

          itSetsSwapFeePercentage();
        });

        context('when the sender is not the owner', () => {
          beforeEach(() => {
            sender = other;
          });

          context('when the sender does not have the set fee permission in the authorizer', () => {
            itRevertsWithUnallowedSender();
          });

          context('when the sender has the set fee permission in the authorizer', () => {
            sharedBeforeEach(async () => {
              const action = await actionId(pool, 'setSwapFeePercentage');
              await authorizer.connect(admin).grantRole(action, sender.address);
            });

            itRevertsWithUnallowedSender();
          });
        });
      });
    });
  });

  describe.skip('asset manager pool config', () => {
    // TODO: add tests for
    //  - asset manager call
    //  - unamanged tokens
    //  - events
    //  - authorization (owner, delegated owner)
  });

  describe('set paused', () => {
    let pool: Contract;
    const PAUSE_WINDOW_DURATION = MONTH * 3;
    const BUFFER_PERIOD_DURATION = MONTH;

    let sender: SignerWithAddress;

    function itCanPause() {
      it('can pause', async () => {
        await pool.connect(sender).setPaused(true);

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.true;
      });

      it('can unpause', async () => {
        await pool.connect(sender).setPaused(true);
        await pool.connect(sender).setPaused(false);

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.false;
      });

      it('cannot unpause after the pause window', async () => {
        await advanceTime(PAUSE_WINDOW_DURATION + DAY);
        await expect(pool.connect(sender).setPaused(true)).to.be.revertedWith('PAUSE_WINDOW_EXPIRED');
      });
    }

    function itRevertsWithUnallowedSender() {
      it('reverts', async () => {
        await expect(pool.connect(sender).setPaused(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
        await expect(pool.connect(sender).setPaused(false)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    }

    context('with a delegated owner', () => {
      const owner = DELEGATE_OWNER;

      sharedBeforeEach('deploy pool', async () => {
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });
      });

      beforeEach('set sender', () => {
        sender = other;
      });

      context('when the sender does not have the pause permission in the authorizer', () => {
        itRevertsWithUnallowedSender();
      });

      context('when the sender has the pause permission in the authorizer', () => {
        sharedBeforeEach('grant permission', async () => {
          const action = await actionId(pool, 'setPaused');
          await authorizer.connect(admin).grantRole(action, sender.address);
        });

        itCanPause();
      });
    });

    context('with an owner', () => {
      let owner: SignerWithAddress;

      sharedBeforeEach('deploy pool', async () => {
        owner = poolOwner;
        pool = await deployBasePool({
          pauseWindowDuration: PAUSE_WINDOW_DURATION,
          bufferPeriodDuration: BUFFER_PERIOD_DURATION,
          owner,
        });
      });

      context('when the sender is the owner', () => {
        beforeEach('set sender', () => {
          sender = owner;
        });

        itRevertsWithUnallowedSender();
      });

      context('when the sender is not the owner', () => {
        beforeEach('set sender', () => {
          sender = other;
        });

        context('when the sender does not have the pause permission in the authorizer', () => {
          itRevertsWithUnallowedSender();
        });

        context('when the sender has the pause permission in the authorizer', () => {
          sharedBeforeEach(async () => {
            const action = await actionId(pool, 'setPaused');
            await authorizer.connect(admin).grantRole(action, sender.address);
          });

          itCanPause();
        });
      });
    });
  });

  describe('misc data', () => {
    let pool: Contract;
    const swapFeePercentage = fp(0.02);

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployBasePool({ swapFeePercentage });
    });

    it('stores the swap fee pct in the most-significant 64 bits', async () => {
      expect(await pool.getSwapFeePercentage()).to.equal(swapFeePercentage);

      const swapFeeHex = swapFeePercentage.toHexString().slice(2); // remove 0x
      const expectedMiscData = swapFeeHex.padStart(16, '0').padEnd(64, '0'); // pad first 8 bytes and fill with zeros

      const miscData = await pool.getMiscData();
      expect(miscData).to.be.equal(`0x${expectedMiscData}`);
    });

    it('can store up-to 192 bits of extra data', async () => {
      const swapFeeHex = `0x${swapFeePercentage.toHexString().slice(2).padStart(16, '0')}`;

      const assertMiscData = async (data: string): Promise<void> => {
        await pool.setMiscData(data);
        const expectedMiscData = `${swapFeeHex}${data.slice(18)}`; // 0x + 16 bits
        expect(await pool.getMiscData()).to.be.equal(expectedMiscData);
      };

      for (let i = 0; i <= 64; i++) {
        const data = `0x${'1'.repeat(i).padStart(64, '0')}`;
        await assertMiscData(data);
      }
    });
  });
});
