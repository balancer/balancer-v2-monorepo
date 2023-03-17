import { ethers } from 'hardhat';
import { Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { range } from 'lodash';

describe('L2BalancerPseudoMinter', () => {
  let vault: Vault;
  let BAL: Contract, pseudoMinter: Contract;
  let admin: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress;
  let gauge: Contract, gaugeFactory: Contract;

  before('setup signers', async () => {
    [, admin, user, other] = await ethers.getSigners();
  });

  async function deployGauge(factory: Contract): Promise<Contract> {
    const tx = await factory.create(ANY_ADDRESS);
    const event = await expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');
    return deployedAt('MockChildChainGauge', event.args.gauge);
  }

  sharedBeforeEach('setup minter and basic contracts', async () => {
    vault = await Vault.create({ admin });
    BAL = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
    pseudoMinter = await deploy('L2BalancerPseudoMinter', { args: [vault.address, BAL.address] });
  });

  sharedBeforeEach('setup test gauge and factory', async () => {
    const version = 'test';
    const gaugeImplementation = await deploy('MockChildChainGauge', { args: [version] });
    gaugeFactory = await deploy('ChildChainGaugeFactory', { args: [gaugeImplementation.address, '', version] });
    gauge = await deployGauge(gaugeFactory);
  });

  describe('addGaugeFactory', () => {
    sharedBeforeEach('give permissions to admin', async () => {
      await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'addGaugeFactory'), admin);
      expect(await pseudoMinter.isValidGaugeFactory(gaugeFactory.address)).to.be.false;
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(pseudoMinter.connect(other).addGaugeFactory(gaugeFactory.address)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is authorized', () => {
      let receipt: ContractReceipt;

      sharedBeforeEach(async () => {
        receipt = await (await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address)).wait();
      });

      it('adds the gauge factory', async () => {
        expect(await pseudoMinter.isValidGaugeFactory(gaugeFactory.address)).to.be.true;
      });

      it('emits an event', async () => {
        expectEvent.inReceipt(receipt, 'GaugeFactoryAdded', { factory: gaugeFactory.address });
      });

      it('reverts with already added factory', async () => {
        await expect(pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address)).to.be.revertedWith(
          'FACTORY_ALREADY_ADDED'
        );
      });
    });
  });

  describe('removeGaugeFactory', () => {
    sharedBeforeEach('give permissions to admin and add factory', async () => {
      await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'removeGaugeFactory'), admin);
      await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'addGaugeFactory'), admin);
      await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address);
      expect(await pseudoMinter.isValidGaugeFactory(gaugeFactory.address)).to.be.true;
    });

    context('when caller is not authorized', () => {
      it('reverts', async () => {
        await expect(pseudoMinter.connect(other).removeGaugeFactory(gaugeFactory.address)).to.be.revertedWith(
          'SENDER_NOT_ALLOWED'
        );
      });
    });

    context('when caller is authorized', () => {
      let receipt: ContractReceipt;

      sharedBeforeEach(async () => {
        receipt = await (await pseudoMinter.connect(admin).removeGaugeFactory(gaugeFactory.address)).wait();
      });

      it('removes the gauge factory', async () => {
        expect(await pseudoMinter.isValidGaugeFactory(gaugeFactory.address)).to.be.false;
      });

      it('emits an event', async () => {
        expectEvent.inReceipt(receipt, 'GaugeFactoryRemoved', { factory: gaugeFactory.address });
      });

      it('reverts with factory not previously added', async () => {
        await expect(pseudoMinter.connect(admin).removeGaugeFactory(ANY_ADDRESS)).to.be.revertedWith(
          'FACTORY_NOT_ADDED'
        );
      });
    });
  });

  describe('mint', () => {
    const mockCheckpointStep = fp(1);

    sharedBeforeEach('setup factory and fund pseudo minter', async () => {
      await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'addGaugeFactory'), admin);
      await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address);
      await BAL.connect(admin).mint(pseudoMinter.address, fp(100));
      expect(await pseudoMinter.minted(user.address, gauge.address)).to.be.eq(0);
    });

    context('when gauge address is invalid', () => {
      it('reverts with valid gauge from invalid factory', async () => {
        await gauge.setMockFactory(ANY_ADDRESS);
        await expect(pseudoMinter.connect(user).mint(gauge.address)).to.be.revertedWith('INVALID_GAUGE_FACTORY');
      });

      it('reverts with malicious gauge prentending to come from a valid factory', async () => {
        const maliciousGauge = await deploy('MockChildChainGauge', { args: ['test'] });
        await maliciousGauge.setMockFactory(gaugeFactory.address);
        await expect(pseudoMinter.connect(user).mint(maliciousGauge.address)).to.be.revertedWith('INVALID_GAUGE');
      });

      it('reverts when the gauge address is an EOA', async () => {
        await expect(pseudoMinter.connect(user).mint(other.address)).to.be.reverted;
      });

      it('reverts when the gauge address is a contract without factory() method', async () => {
        await expect(pseudoMinter.connect(user).mint(vault.address)).to.be.reverted;
      });
    });

    context('when the amount of tokens to transfer is greater than 0', () => {
      let receipt: ContractReceipt;

      sharedBeforeEach('ensure there will be tokens to transfer after next checkpoint', async () => {
        // Accounting on the gauge will increase by this amount on every checkpoint.
        await gauge.setMockCheckpointStep(mockCheckpointStep);
        receipt = await (await pseudoMinter.connect(user).mint(gauge.address)).wait();
      });

      it('transfers the right amount of tokens to the user', async () => {
        await expectTransferEvent(
          receipt,
          { from: pseudoMinter.address, to: user.address, value: mockCheckpointStep },
          BAL
        );
      });

      it('updates total minted amount for the user', async () => {
        const totalBefore = await pseudoMinter.minted(user.address, gauge.address);
        await pseudoMinter.connect(user).mint(gauge.address);
        expect(await pseudoMinter.minted(user.address, gauge.address)).to.be.eq(totalBefore.add(mockCheckpointStep));
      });

      it('emits an event', async () => {
        await expectEvent.inReceipt(receipt, 'Minted', {
          recipient: user.address,
          gauge: gauge.address,
          minted: mockCheckpointStep,
        });
      });

      it('calls gauge user checkpoint', async () => {
        await expectEvent.inIndirectReceipt(receipt, gauge.interface, 'UserCheckpoint', {
          user: user.address,
        });
      });
    });

    context('when the amount of tokens to transfer is 0', () => {
      let receipt: ContractReceipt;

      sharedBeforeEach('ensure there will be tokens to transfer after next checkpoint', async () => {
        // Accounting on the gauge will not increase after a checkpoint.
        await gauge.setMockCheckpointStep(0);
        receipt = await (await pseudoMinter.connect(user).mint(gauge.address)).wait();
      });

      it('performs no transfers', async () => {
        expectEvent.notEmitted(receipt, 'Transfer');
      });

      it('keeps the same minted amount for the user', async () => {
        const totalBefore = await pseudoMinter.minted(user.address, gauge.address);
        await pseudoMinter.connect(user).mint(gauge.address);
        expect(await pseudoMinter.minted(user.address, gauge.address)).to.be.eq(totalBefore);
      });

      it('skips Minted event', async () => {
        expectEvent.notEmitted(receipt, 'Minted');
      });

      it('calls gauge user checkpoint', async () => {
        await expectEvent.inIndirectReceipt(receipt, gauge.interface, 'UserCheckpoint', {
          user: user.address,
        });
      });
    });
  });

  describe('mintMany', () => {
    const mockCheckpointStep = fp(1);
    let gauges: Contract[];
    let gaugeAddresses: string[];

    sharedBeforeEach('setup factory and fund pseudo minter', async () => {
      await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'addGaugeFactory'), admin);
      await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address);
      await BAL.connect(admin).mint(pseudoMinter.address, fp(100));

      gauges = await Promise.all(
        range(3).map(() => {
          return deployGauge(gaugeFactory);
        })
      );
      gaugeAddresses = gauges.map((gauge) => gauge.address);
    });

    context('when one of the gauge addresses is invalid', () => {
      it('reverts with valid gauge from invalid factory', async () => {
        await gauges[0].setMockFactory(ANY_ADDRESS);
        await expect(pseudoMinter.connect(user).mintMany(gaugeAddresses)).to.be.revertedWith('INVALID_GAUGE_FACTORY');
      });

      it('reverts with malicious gauge prentending to come from a valid factory', async () => {
        const maliciousGauge = await deploy('MockChildChainGauge', { args: ['test'] });
        await maliciousGauge.setMockFactory(gaugeFactory.address);
        const gaugesWithMalicious = [...gaugeAddresses, maliciousGauge.address];
        await expect(pseudoMinter.connect(user).mintMany(gaugesWithMalicious)).to.be.revertedWith('INVALID_GAUGE');
      });

      it('reverts when a gauge address is an EOA', async () => {
        const gaugesWithEOA = [...gaugeAddresses, other.address];
        await expect(pseudoMinter.connect(user).mintMany(gaugesWithEOA)).to.be.reverted;
      });

      it('reverts when the gauge address is a contract without factory() method', async () => {
        const gaugesWithNoFactory = [...gaugeAddresses, vault.address];
        await expect(pseudoMinter.connect(user).mintMany(gaugesWithNoFactory)).to.be.reverted;
      });
    });

    context('when the amount of tokens to transfer is greater than 0', () => {
      let receipt: ContractReceipt;

      sharedBeforeEach('ensure there will be tokens to transfer after next checkpoint', async () => {
        // Accounting on the gauge will increase by this amount on every checkpoint.
        await Promise.all(gauges.map((gauge) => gauge.setMockCheckpointStep(mockCheckpointStep)));
        receipt = await (await pseudoMinter.connect(user).mintMany(gaugeAddresses)).wait();
      });

      it('transfers the right amount of tokens to the user in a single transfer', async () => {
        await expectTransferEvent(
          receipt,
          { from: pseudoMinter.address, to: user.address, value: mockCheckpointStep.mul(gauges.length) },
          BAL
        );
      });

      it('updates total minted amount for the user for each gauge', async () => {
        const totalsBefore = await Promise.all(gauges.map((gauge) => pseudoMinter.minted(user.address, gauge.address)));
        await pseudoMinter.connect(user).mintMany(gaugeAddresses);
        const totalsAfter = await Promise.all(gauges.map((gauge) => pseudoMinter.minted(user.address, gauge.address)));
        expect(totalsAfter).to.be.deep.eq(totalsBefore.map((totalBefore) => totalBefore.add(mockCheckpointStep)));
      });

      it('emits an event per gauge', async () => {
        gauges.map((gauge) =>
          expectEvent.inReceipt(receipt, 'Minted', {
            recipient: user.address,
            gauge: gauge.address,
            minted: mockCheckpointStep,
          })
        );
      });

      it('calls gauge user checkpoint for every gauge', async () => {
        gauges.map((gauge) =>
          expectEvent.inIndirectReceipt(receipt, gauge.interface, 'UserCheckpoint', {
            user: user.address,
          })
        );
      });
    });

    context('when the amount of tokens to transfer is 0', () => {
      let receipt: ContractReceipt;

      sharedBeforeEach('ensure there will be no tokens to transfer after next checkpoint', async () => {
        // Accounting on the gauges will not increase after a checkpoint.
        await Promise.all(gauges.map((gauge) => gauge.setMockCheckpointStep(0)));
        receipt = await (await pseudoMinter.connect(user).mintMany(gaugeAddresses)).wait();
      });

      it('performs no transfers', async () => {
        expectEvent.notEmitted(receipt, 'Transfer');
      });

      it('keeps the same minted amount for the user', async () => {
        const totalsBefore = await Promise.all(gauges.map((gauge) => pseudoMinter.minted(user.address, gauge.address)));
        await pseudoMinter.connect(user).mintMany(gaugeAddresses);
        const totalsAfter = await Promise.all(gauges.map((gauge) => pseudoMinter.minted(user.address, gauge.address)));
        expect(totalsAfter).to.be.deep.eq(totalsBefore);
      });

      it('skips Minted event', async () => {
        expectEvent.notEmitted(receipt, 'Minted');
      });

      it('calls gauge user checkpoint for every gauge', async () => {
        await Promise.all(
          gauges.map((gauge) =>
            expectEvent.inIndirectReceipt(receipt, gauge.interface, 'UserCheckpoint', {
              user: user.address,
            })
          )
        );
      });
    });
  });
});
