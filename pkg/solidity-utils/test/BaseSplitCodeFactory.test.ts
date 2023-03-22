import { Contract } from 'ethers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { ONES_BYTES32, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';
import { randomBytes } from 'ethers/lib/utils';

describe('BasePoolCodeFactory', function () {
  let factory: Contract;

  const INVALID_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const id = '0x0123456789012345678901234567890123456789012345678901234567890123';

  sharedBeforeEach(async () => {
    factory = await deploy('MockSplitCodeFactory', { args: [] });
  });

  it('returns the contract creation code storage addresses', async () => {
    const { contractA, contractB } = await factory.getCreationCodeContracts();

    const codeA = await ethers.provider.getCode(contractA);
    const codeB = await ethers.provider.getCode(contractB);

    const artifact = getArtifact('MockFactoryCreatedContract');
    expect(codeA.concat(codeB.slice(2))).to.equal(artifact.bytecode); // Slice to remove the '0x' prefix
  });

  it('returns the contract creation code', async () => {
    const artifact = getArtifact('MockFactoryCreatedContract');
    const poolCreationCode = await factory.getCreationCode();

    expect(poolCreationCode).to.equal(artifact.bytecode);
  });

  it('creates a contract', async () => {
    const receipt = await (await factory.create(id, ZERO_BYTES32)).wait();
    expectEvent.inReceipt(receipt, 'ContractCreated');
  });

  context('when the creation reverts', () => {
    it('reverts and bubbles up revert reasons', async () => {
      await expect(factory.create(INVALID_ID, ZERO_BYTES32)).to.be.revertedWith('NON_ZERO_ID');
    });
  });

  context('with a created pool', () => {
    let contract: string;

    sharedBeforeEach('create contract', async () => {
      const receipt = await (await factory.create(id, ZERO_BYTES32)).wait();
      const event = expectEvent.inReceipt(receipt, 'ContractCreated');

      contract = event.args.destination;
    });

    it('deploys correct bytecode', async () => {
      const code = await ethers.provider.getCode(contract);
      const artifact = getArtifact('MockFactoryCreatedContract');
      expect(code).to.equal(artifact.deployedBytecode);
    });

    it('cannot deploy twice with the same salt', async () => {
      await expect(factory.create(id, ZERO_BYTES32)).to.be.reverted;
    });

    it('can deploy with a different salt', async () => {
      await expect(factory.create(id, ONES_BYTES32)).to.not.be.reverted;
    });

    it('passes constructor arguments correctly', async () => {
      const contractObject = await deployedAt('MockFactoryCreatedContract', contract);
      expect(await contractObject.getId()).to.equal(id);
    });

    it('generates the same address with the same salt and a different nonce', async () => {
      // We need to deploy with a reference salt, then "rollback" to before this deployment,
      // so that the address no longer has code (which would cause deployment to revert).
      // Take a snapshot we can roll back to.
      const snapshot = await takeSnapshot();

      // Deploy with the reference salt and record the address.
      let receipt = await (await factory.create(id, ONES_BYTES32)).wait();
      let event = expectEvent.inReceipt(receipt, 'ContractCreated');

      const targetAddress = event.args.destination;

      // Roll back to before the deployment
      await snapshot.restore();

      // Deploy the same factory with random salts, to increase the nonce
      receipt = await (await factory.create(id, randomBytes(32))).wait();
      event = expectEvent.inReceipt(receipt, 'ContractCreated');
      expect(event.args.destination).to.not.equal(targetAddress);

      receipt = await (await factory.create(id, randomBytes(32))).wait();
      event = expectEvent.inReceipt(receipt, 'ContractCreated');
      expect(event.args.destination).to.not.equal(targetAddress);

      // Use the same salt again; it should generate the same address
      receipt = await (await factory.create(id, ONES_BYTES32)).wait();
      event = expectEvent.inReceipt(receipt, 'ContractCreated');
      expect(event.args.destination).to.equal(targetAddress);
    });
  });
});
