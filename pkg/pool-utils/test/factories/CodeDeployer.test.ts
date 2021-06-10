import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('CodeDeployer', function () {
  context('with no code', () => {
    itStoresArgumentAsCode('0x');
  });

  context('with some code', () => {
    itStoresArgumentAsCode('0x1234');
  });

  context('with code 24kB long', () => {
    itStoresArgumentAsCode(`0x${'f'.repeat(24 * 1024)}`);
  });

  context('with code over 24kB long', () => {
    it('reverts', async () => {
      const data = `0x${'f'.repeat(24 * 1024 + 1)}`;
      await expect(deploy('CodeDeployer', { args: [data] })).to.be.reverted;
    });
  });

  function itStoresArgumentAsCode(data: string) {
    it('stores its constructor argument as its code', async () => {
      const deployer = await deploy('CodeDeployer', { args: [data] });
      expect(await ethers.provider.getCode(deployer.address)).to.equal(data);
    });
  }
});
