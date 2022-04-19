import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describe('TimelockExecutor', () => {
  let executor: Contract, token: Contract;
  let authorizer: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, authorizer, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy contracts', async () => {
    token = await deploy('v2-solidity-utils/ERC20Mock', { args: ['Token', 'TKN'] });
    executor = await deploy('TimelockExecutor', { from: authorizer });
  });

  describe('call', () => {
    let data: string;
    const amount = fp(1);

    sharedBeforeEach('prepare data', async () => {
      data = await token.interface.encodeFunctionData('mint', [other.address, amount]);
    });

    context('when the sender is the authorizer', () => {
      it('forwards the given call', async () => {
        const previousAmount = await token.balanceOf(other.address);

        await executor.connect(authorizer).execute(token.address, data);

        expect(await token.balanceOf(other.address)).to.be.equal(previousAmount.add(amount));
      });
    });

    context('when the sender is not the authorizer', () => {
      it('reverts', async () => {
        await expect(executor.connect(other).execute(token.address, data)).to.be.revertedWith(
          'ERR_SENDER_NOT_AUTHORIZER'
        );
      });
    });
  });
});
