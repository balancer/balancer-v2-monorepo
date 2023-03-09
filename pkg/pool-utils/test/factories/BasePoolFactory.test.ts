import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MONTH, DAY, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { expect } from 'chai';
import { fp, bn } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('BasePoolFactory', function () {
  const PAUSE_WINDOW_DURATION = 90 * DAY;
  const BUFFER_PERIOD_DURATION = 30 * DAY;

  let vault: Contract;
  let factory: Contract;
  let authorizer: Contract;
  let admin: SignerWithAddress;
  let other: SignerWithAddress;
  let protocolFeesProvider: Contract;

  before('setup signers', async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    ({
      instance: vault,
      authorizer,
      protocolFeesProvider,
    } = await Vault.create({
      admin,
      pauseWindowDuration: MONTH,
      bufferPeriodDuration: MONTH,
      maxYieldValue: fp(1),
      maxAUMValue: fp(1),
    }));

    factory = await deploy('MockPoolFactory', {
      args: [vault.address, protocolFeesProvider.address, PAUSE_WINDOW_DURATION, BUFFER_PERIOD_DURATION],
    });

    const action = await actionId(factory, 'disable');
    await authorizer.connect(admin).grantPermission(action, admin.address, ANY_ADDRESS);
  });

  it('stores the vault address', async () => {
    expect(await factory.getVault()).to.equal(vault.address);
  });

  it('stores the fee provider address', async () => {
    expect(await factory.getProtocolFeePercentagesProvider()).to.equal(protocolFeesProvider.address);
  });

  it('emits an event', async () => {
    const receipt = await (await factory.create()).wait();
    expectEvent.inReceipt(receipt, 'PoolCreated');
  });

  context('with a created pool', () => {
    let pool: string;

    sharedBeforeEach('create pool', async () => {
      const receipt = await (await factory.create()).wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');

      pool = event.args.pool;
    });

    it('tracks pools created by the factory', async () => {
      expect(await factory.isPoolFromFactory(pool)).to.be.true;
    });

    it('does not track pools that were not created by the factory', async () => {
      expect(await factory.isPoolFromFactory(other.address)).to.be.false;
    });
  });

  describe('disable', () => {
    context('when enabled', () => {
      it('disabled should be false', async () => {
        expect(await factory.isDisabled()).to.be.false;
      });

      it('allows creation', async () => {
        await expect(factory.create()).to.not.be.reverted;
      });

      it('prevents non-admins from disabling', async () => {
        await expect(factory.connect(other).disable()).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when disabled', () => {
      sharedBeforeEach('disable the factory', async () => {
        const receipt = await factory.connect(admin).disable();

        expectEvent.inReceipt(await receipt.wait(), 'FactoryDisabled');
      });

      it('disabled should be true', async () => {
        expect(await factory.isDisabled()).to.be.true;
      });

      it('should not allow creation', async () => {
        await expect(factory.create()).to.be.revertedWith('DISABLED');
      });

      it('should not allow disabling twice', async () => {
        await expect(factory.connect(admin).disable()).to.be.revertedWith('DISABLED');
      });
    });
  });

  describe('pause durations', () => {
    let factoryDeployTime: BigNumber;

    sharedBeforeEach(async () => {
      factory = await deploy('MockPoolFactory', {
        args: [vault.address, protocolFeesProvider.address, PAUSE_WINDOW_DURATION, BUFFER_PERIOD_DURATION],
      });
      factoryDeployTime = await currentTimestamp();
    });

    context('with invalid durations', () => {
      let maxPauseWindow: number;
      let maxBuffer: number;

      sharedBeforeEach(async () => {
        maxPauseWindow = await factory.getMaxPauseWindowDuration();
        maxBuffer = await factory.getMaxBufferPeriodDuration();
      });

      it('rejects a pause window duration above the max', async () => {
        await expect(
          deploy('MockPoolFactory', {
            args: [vault.address, protocolFeesProvider.address, maxPauseWindow + 1, BUFFER_PERIOD_DURATION],
          })
        ).to.be.revertedWith('MAX_PAUSE_WINDOW_DURATION');
      });

      it('rejects a buffer duration above the max', async () => {
        await expect(
          deploy('MockPoolFactory', {
            args: [vault.address, protocolFeesProvider.address, PAUSE_WINDOW_DURATION, maxBuffer + 1],
          })
        ).to.be.revertedWith('MAX_BUFFER_PERIOD_DURATION');
      });
    });

    context('with valid durations', () => {
      it('returns the current pause window duration', async () => {
        const now = await currentTimestamp();
        const expectedDuration = bn(PAUSE_WINDOW_DURATION).sub(now.sub(factoryDeployTime));

        const { pauseWindowDuration } = await factory.getPauseConfiguration();
        expect(pauseWindowDuration).to.equal(expectedDuration);
      });

      it('returns the buffer period duration', async () => {
        const { bufferPeriodDuration } = await factory.getPauseConfiguration();
        expect(bufferPeriodDuration).to.equal(BUFFER_PERIOD_DURATION);
      });
    });
  });
});
