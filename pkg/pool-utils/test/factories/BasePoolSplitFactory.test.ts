import { Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';

describe('BasePoolSplitFactory', function () {
  let vault: Contract;
  let factory: Contract;
  let other: SignerWithAddress;

  before('setup signers', async () => {
    [, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    vault = await deploy('v2-vault/Vault', { args: [ZERO_ADDRESS, ZERO_ADDRESS, 0, 0] });
    factory = await deploy('MockPoolSplitFactory', { args: [vault.address] });
  });

  it('stores the vault address', async () => {
    expect(await factory.getVault()).to.equal(vault.address);
  });

  it('returns the pool creation code storage addresses', async () => {
    const { storageA, storageB } = await factory.getPoolCreationCodeStorage();

    const codeA = await ethers.provider.getCode(storageA);
    const codeB = await ethers.provider.getCode(storageB);

    const artifact = await getArtifact('MockFactoryCreatedPool');
    expect(codeA.concat(codeB.slice(2))).to.equal(artifact.bytecode); // Slice to remove the '0x' prefix
  });

  it('returns the pool creation code', async () => {
    const artifact = await getArtifact('MockFactoryCreatedPool');
    const poolCreationCode = await factory.getPoolCreationCode();

    expect(poolCreationCode).to.equal(artifact.bytecode);
  });

  it('creates a pool', async () => {
    const receipt = await (await factory.create()).wait();
    expectEvent.inReceipt(receipt, 'PoolCreated');
  });

  context('with a created pool', () => {
    let pool: string;

    sharedBeforeEach('deploy pool', async () => {
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
});
