import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { Account } from '@balancer-labs/v2-helpers/src/models/types/types';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';

describe('RecoveryModePool', function () {
  let admin: SignerWithAddress, poolOwner: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const MIN_SWAP_FEE_PERCENTAGE = fp(0.000001);
  const DELEGATE_OWNER = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';
  const PAUSE_WINDOW_DURATION = MONTH * 3;
  const BUFFER_PERIOD_DURATION = MONTH;

  before(async () => {
    [, admin, poolOwner, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
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

    return deploy('MockLegacyBasePool', {
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

  describe('pause and recovery mode', () => {
    let pool: Contract;
    let sender: SignerWithAddress;

    function pausingEntersRecoveryMode() {
      it('pausing enters recovery mode', async () => {
        await pool.connect(sender).pause();

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.true;
        expect(await pool.inRecoveryMode()).to.be.true;
      });

      it('pausing emits events', async () => {
        const tx = await pool.connect(sender).pause();
        const receipt = await tx.wait();

        expectEvent.inReceipt(receipt, 'PausedStateChanged', { paused: true });
        expectEvent.inReceipt(receipt, 'RecoveryModeStateChanged', { recoveryMode: true });
      });

      it('unpause does not exit recovery mode', async () => {
        await pool.connect(sender).pause();
        await pool.connect(sender).unpause();

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.false;
        expect(await pool.inRecoveryMode()).to.be.true;
      });
    }

    function itRevertsWithUnallowedSender() {
      it('reverts', async () => {
        await expect(pool.connect(sender).enterRecoveryMode()).to.be.revertedWith('SENDER_NOT_ALLOWED');
        await expect(pool.connect(sender).exitRecoveryMode()).to.be.revertedWith('SENDER_NOT_ALLOWED');
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

      context('when the sender does not have the pause/recovery mode permission in the authorizer', () => {
        itRevertsWithUnallowedSender();
      });

      context('when the sender has the pause/recovery mode permission in the authorizer', () => {
        sharedBeforeEach('grant permission', async () => {
          const pauseAction = await actionId(pool, 'pause');
          const unpauseAction = await actionId(pool, 'unpause');
          const enterRecoveryAction = await actionId(pool, 'pause');
          const exitRecoveryAction = await actionId(pool, 'unpause');
          await authorizer
            .connect(admin)
            .grantPermissions([pauseAction, unpauseAction, enterRecoveryAction, exitRecoveryAction], sender.address, [
              ANY_ADDRESS,
              ANY_ADDRESS,
              ANY_ADDRESS,
              ANY_ADDRESS,
            ]);
        });

        pausingEntersRecoveryMode();
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

        context('when the sender does not have the pause/recovery mode permission in the authorizer', () => {
          itRevertsWithUnallowedSender();
        });

        context('when the sender has the pause/recovery mode permission in the authorizer', () => {
          sharedBeforeEach(async () => {
            const pauseAction = await actionId(pool, 'pause');
            const unpauseAction = await actionId(pool, 'unpause');
            const enterRecoveryAction = await actionId(pool, 'pause');
            const exitRecoveryAction = await actionId(pool, 'unpause');
            await authorizer
              .connect(admin)
              .grantPermissions([pauseAction, unpauseAction, enterRecoveryAction, exitRecoveryAction], sender.address, [
                ANY_ADDRESS,
                ANY_ADDRESS,
                ANY_ADDRESS,
                ANY_ADDRESS,
              ]);
          });

          pausingEntersRecoveryMode();
        });
      });
    });
  });

  describe('recovery mode', () => {
    let pool: Contract;
    let sender: SignerWithAddress;

    function itCanEnterRecoveryMode() {
      it('can enter recovery mode', async () => {
        await pool.connect(sender).enterRecoveryMode();

        const recoveryMode = await pool.inRecoveryMode();
        expect(recoveryMode).to.be.true;
      });

      it('entering recovery mode emits an event', async () => {
        const tx = await pool.connect(sender).enterRecoveryMode();
        const receipt = await tx.wait();
        expectEvent.inReceipt(receipt, 'RecoveryModeStateChanged', { recoveryMode: true });
      });

      it('entering recovery mode does not pause the pool', async () => {
        await pool.connect(sender).enterRecoveryMode();

        const recoveryMode = await pool.inRecoveryMode();
        expect(recoveryMode).to.be.true;
        const { paused } = await pool.getPausedState();
        expect(paused).to.be.false;
      });

      it('can exit recovery mode', async () => {
        await pool.connect(sender).enterRecoveryMode();
        await pool.connect(sender).exitRecoveryMode();

        const recoveryMode = await pool.inRecoveryMode();
        expect(recoveryMode).to.be.false;
      });

      it('exiting recovery mode emits an event', async () => {
        await pool.connect(sender).enterRecoveryMode();
        const tx = await pool.connect(sender).exitRecoveryMode();
        const receipt = await tx.wait();
        expectEvent.inReceipt(receipt, 'RecoveryModeStateChanged', { recoveryMode: false });

        const recoveryMode = await pool.inRecoveryMode();
        expect(recoveryMode).to.be.false;
      });

      it('reverts when calling functions in the wrong mode', async () => {
        await expect(pool.notCallableInRecovery()).to.not.be.reverted;
        await expect(pool.onlyCallableInRecovery()).to.be.revertedWith('NOT_IN_RECOVERY_MODE');

        await pool.connect(sender).enterRecoveryMode();

        await expect(pool.doNotCallInRecovery()).to.be.revertedWith('IN_RECOVERY_MODE');
        await expect(pool.notCallableInRecovery()).to.be.revertedWith('IN_RECOVERY_MODE');
        await expect(pool.onlyCallableInRecovery()).to.not.be.reverted;
      });
    }

    function itRevertsWithUnallowedSender() {
      it('reverts', async () => {
        await expect(pool.connect(sender).enterRecoveryMode()).to.be.revertedWith('SENDER_NOT_ALLOWED');
        await expect(pool.connect(sender).exitRecoveryMode()).to.be.revertedWith('SENDER_NOT_ALLOWED');
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

      context('when the sender does not have the recovery mode permission in the authorizer', () => {
        itRevertsWithUnallowedSender();
      });

      context('when the sender has the recovery mode permission in the authorizer', () => {
        sharedBeforeEach('grant permission', async () => {
          const enterRecoveryAction = await actionId(pool, 'enterRecoveryMode');
          const exitRecoveryAction = await actionId(pool, 'exitRecoveryMode');
          await authorizer
            .connect(admin)
            .grantPermissions([enterRecoveryAction, exitRecoveryAction], sender.address, [ANY_ADDRESS, ANY_ADDRESS]);
        });

        itCanEnterRecoveryMode();
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

        context('when the sender does not have the recovery mode permission in the authorizer', () => {
          itRevertsWithUnallowedSender();
        });

        context('when the sender has the recovery mode permission in the authorizer', () => {
          sharedBeforeEach('grant permission', async () => {
            const enterRecoveryAction = await actionId(pool, 'enterRecoveryMode');
            const exitRecoveryAction = await actionId(pool, 'exitRecoveryMode');
            await authorizer
              .connect(admin)
              .grantPermissions([enterRecoveryAction, exitRecoveryAction], sender.address, [ANY_ADDRESS, ANY_ADDRESS]);
          });

          itCanEnterRecoveryMode();
        });
      });
    });
  });
});
