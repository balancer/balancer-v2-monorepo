import { Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ethers } from 'hardhat';

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

    const artifact = await getArtifact('MockFactoryCreatedContract');
    expect(codeA.concat(codeB.slice(2))).to.equal(artifact.bytecode); // Slice to remove the '0x' prefix
  });

  it('returns the contract creation code', async () => {
    const artifact = await getArtifact('MockFactoryCreatedContract');
    const poolCreationCode = await factory.getCreationCode();

    expect(poolCreationCode).to.equal(artifact.bytecode);
  });

  it('creates a contract', async () => {
    const receipt = await (await factory.create(id)).wait();
    expectEvent.inReceipt(receipt, 'ContractCreated');
  });

  context('when the creation reverts', () => {
    it('reverts and bubbles up revert reasons', async () => {
      await expect(factory.create(INVALID_ID)).to.be.revertedWith('NON_ZERO_ID');
    });
  });

  context('with a created pool', () => {
    let contract: string;

    sharedBeforeEach('create contract', async () => {
      const receipt = await (await factory.create(id)).wait();
      const event = expectEvent.inReceipt(receipt, 'ContractCreated');

      contract = event.args.destination;
    });

    it('deploys correct bytecode', async () => {
      const code = await ethers.provider.getCode(contract);
      const artifact = await getArtifact('MockFactoryCreatedContract');
      expect(code).to.equal(artifact.deployedBytecode);
    });

    it('passes constructor arguments correctly', async () => {
      const contractObject = await deployedAt('MockFactoryCreatedContract', contract);
      expect(await contractObject.getId()).to.equal(id);
    });
  });
});
