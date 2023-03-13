import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('TimelockExecutionHelper', () => {
  let executionHelper: Contract, token: Contract;
  let authorizer: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, authorizer, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy contracts', async () => {
    token = await deploy('v2-solidity-utils/ERC20Mock', { args: ['Token', 'TKN'] });
    executionHelper = await deploy('TimelockExecutionHelper', { from: authorizer });
  });

  describe('execute', () => {
    context('when the sender is the authorizer', () => {
      it('forwards the given call', async () => {
        const previousAmount = await token.balanceOf(other.address);

        const mintAmount = fp(1);
        await executionHelper
          .connect(authorizer)
          .execute(token.address, token.interface.encodeFunctionData('mint', [other.address, mintAmount]));

        expect(await token.balanceOf(other.address)).to.be.equal(previousAmount.add(mintAmount));
      });

      it('reverts if the call is reentrant', async () => {
        await expect(
          executionHelper
            .connect(authorizer)
            .execute(
              executionHelper.address,
              executionHelper.interface.encodeFunctionData('execute', [ZERO_ADDRESS, '0x'])
            )
        ).to.be.revertedWith('REENTRANCY');
      });
    });

    context('when the sender is not the authorizer', () => {
      it('reverts', async () => {
        await expect(executionHelper.connect(other).execute(token.address, '0x')).to.be.revertedWith(
          'SENDER_IS_NOT_AUTHORIZER'
        );
      });
    });
  });
});
