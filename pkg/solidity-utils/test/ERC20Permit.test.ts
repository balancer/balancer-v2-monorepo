import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256 as MAX_DEADLINE } from '@balancer-labs/v2-helpers/src/constants';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { signPermit } from '@balancer-labs/balancer-js';
import { currentTimestamp } from '@balancer-labs/v2-helpers/src/time';

describe('ERC20Permit', () => {
  let token: Contract;
  let holder: SignerWithAddress, spender: SignerWithAddress;

  before('setup signers', async () => {
    [, holder, spender] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token', async () => {
    token = await deploy('ERC20PermitMock', { args: ['Token', 'TKN'] });
  });

  describe('info', () => {
    it('setups the name properly', async () => {
      expect(await token.name()).to.be.equal('Token');
    });
  });

  describe('permit', () => {
    it('initial nonce is zero', async () => {
      expect(await token.nonces(holder.address)).to.equal(0);
    });

    const amount = bn(42);

    it('accepts holder signature', async function () {
      const previousNonce = await token.nonces(holder.address);
      const { v, r, s } = await signPermit(token, holder, spender, amount);

      const receipt = await (await token.permit(holder.address, spender.address, amount, MAX_DEADLINE, v, r, s)).wait();
      expectEvent.inReceipt(receipt, 'Approval', { owner: holder.address, spender: spender.address, value: amount });

      expect(await token.nonces(holder.address)).to.equal(previousNonce.add(1));
      expect(await token.allowance(holder.address, spender.address)).to.equal(amount);
    });

    context('with invalid signature', () => {
      let v: number, r: string, s: string, deadline: BigNumber;

      context('with reused signature', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(token, holder, spender, amount));
          await token.permit(holder.address, spender.address, amount, deadline, v, r, s);
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature for other holder', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(token, spender, spender, amount));
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature for other spender', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(token, holder, holder, amount));
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature for other amount', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(token, holder, spender, amount.add(1)));
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature for other token', () => {
        beforeEach(async () => {
          const otherToken = await deploy('ERC20PermitMock', { args: ['Token', 'TKN'] });

          ({ v, r, s, deadline } = await signPermit(otherToken, holder, spender, amount));
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature with invalid nonce', () => {
        beforeEach(async () => {
          const currentNonce = await token.nonces(holder.address);
          ({ v, r, s, deadline } = await signPermit(token, holder, spender, amount, MAX_DEADLINE, currentNonce.add(1)));
        });

        itRevertsWithInvalidSignature();
      });

      context('with expired deadline', () => {
        beforeEach(async () => {
          const now = await currentTimestamp();

          ({ v, r, s, deadline } = await signPermit(token, holder, spender, amount, now.sub(1)));
        });

        itRevertsWithInvalidSignature('EXPIRED_PERMIT');
      });

      function itRevertsWithInvalidSignature(reason?: string) {
        it('reverts', async () => {
          await expect(token.permit(holder.address, spender.address, amount, deadline, v, r, s)).to.be.revertedWith(
            reason ?? 'INVALID_SIGNATURE'
          );
        });
      }
    });
  });
});
