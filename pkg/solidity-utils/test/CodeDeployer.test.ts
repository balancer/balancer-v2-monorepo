import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('CodeDeployer', function () {
  let factory: Contract;

  sharedBeforeEach(async () => {
    factory = await deploy('CodeDeployerFactory', { args: [] });
  });

  context('with no code', () => {
    itStoresArgumentAsCode('0x');
  });

  context('with some code', () => {
    itStoresArgumentAsCode('0x1234');
  });

  context('with code 24kB long', () => {
    itStoresArgumentAsCode(`0x${'00'.repeat(24 * 1024)}`);
  });

  context('with code over 24kB long', () => {
    it('reverts', async () => {
      const data = `0x${'00'.repeat(24 * 1024 + 1)}`;
      await expect(factory.deploy(data)).to.be.revertedWith('CODE_DEPLOYMENT_FAILED');
    });
  });

  function itStoresArgumentAsCode(data: string) {
    it('stores its constructor argument as its code', async () => {
      const receipt = await (await factory.deploy(data)).wait();
      const event = expectEvent.inReceipt(receipt, 'CodeDeployed');

      expect(await ethers.provider.getCode(event.args.at)).to.equal(data);
    });
  }
});
