import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('CodeDeployer', function () {
  let factory: Contract;
  let admin: SignerWithAddress;

  before('setup signers', async () => {
    [, admin] = await ethers.getSigners();
  });

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
      await expect(factory.deploy(data, false)).to.be.revertedWith('CODE_DEPLOYMENT_FAILED');
    });
  });

  function itStoresArgumentAsCode(data: string) {
    it('stores its constructor argument as its code', async () => {
      const receipt = await (await factory.deploy(data, false)).wait();
      const event = expectEvent.inReceipt(receipt, 'CodeDeployed');

      expect(await ethers.provider.getCode(event.args.destination)).to.equal(data);
    });
  }

  describe('CodeDeployer protection', () => {
    let deployedContract: string;

    context('raw selfdestruct', () => {
      // PUSH0
      // SELFDESTRUCT
      // STOP (optional - works without this)
      const code = '0x5fff00';

      sharedBeforeEach('deploy contract', async () => {
        const receipt = await (await factory.deploy(code, false)).wait();
        const event = expectEvent.inReceipt(receipt, 'CodeDeployed');

        deployedContract = event.args.destination;
      });

      itStoresArgumentAsCode(code);

      it('self destructs', async () => {
        const tx = {
          to: deployedContract,
          value: ethers.utils.parseEther('0.001'),
        };

        await admin.sendTransaction(tx);

        expect(await ethers.provider.getCode(deployedContract)).to.equal('0x');
      });
    });

    context('protected selfdestruct', () => {
      // INVALID
      // PUSH0
      // SELFDESTRUCT
      // STOP (optional - works without this)
      const code = '0x5fff00';
      const safeCode = '0xfe5fff00';

      sharedBeforeEach('deploy contract', async () => {
        // Pass it the unmodified code
        const receipt = await (await factory.deploy(code, true)).wait();
        const event = expectEvent.inReceipt(receipt, 'CodeDeployed');

        deployedContract = event.args.destination;
      });

      // It should actually store the safecode
      itStoresArgumentAsCode(safeCode);

      it('does not self destruct', async () => {
        const tx = {
          to: deployedContract,
          value: ethers.utils.parseEther('0.001'),
        };

        await expect(admin.sendTransaction(tx)).to.be.reverted;

        // Should still have the safeCode
        expect(await ethers.provider.getCode(deployedContract)).to.equal(safeCode);
      });
    });
  });
});
