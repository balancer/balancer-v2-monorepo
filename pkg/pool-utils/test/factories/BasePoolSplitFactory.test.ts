import { Contract } from 'ethers';

import { deploy, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('BasePoolSplitFactory', function () {
  let vault: Contract;
  let factory: Contract;

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
});
