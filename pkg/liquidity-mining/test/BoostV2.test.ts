import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256 as MAX_DEADLINE, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { signPermit } from '@balancer-labs/balancer-js';
import { currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('VeBoostV2', () => {
  let boost: Contract;
  let holder: SignerWithAddress, spender: SignerWithAddress;

  before('setup signers', async () => {
    [, holder, spender] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy veBoostV2', async () => {
    boost = await deploy('VeBoostV2', { args: [ZERO_ADDRESS, ZERO_ADDRESS] });
  });

  describe('info', () => {
    it('sets up the name properly', async () => {
      expect(await boost.name()).to.be.equal('Vote-Escrowed Boost');
    });

    it('sets up the symbol properly', async () => {
      expect(await boost.symbol()).to.be.equal('veBoost');
    });

    it('sets up the version properly', async () => {
      expect(await boost.version()).to.be.equal('v2.0.0');
    });
  });

  describe('permit', () => {
    it('initial nonce is zero', async () => {
      expect(await boost.nonces(holder.address)).to.equal(0);
    });

    const amount = bn(42);

    it('accepts holder signature', async function () {
      const previousNonce = await boost.nonces(holder.address);
      const { v, r, s } = await signPermit(boost, holder, spender, amount);

      const receipt = await (await boost.permit(holder.address, spender.address, amount, MAX_DEADLINE, v, r, s)).wait();
      expectEvent.inReceipt(receipt, 'Approval', { _owner: holder.address, _spender: spender.address, _value: amount });

      expect(await boost.nonces(holder.address)).to.equal(previousNonce.add(1));
      expect(await boost.allowance(holder.address, spender.address)).to.equal(amount);
    });

    context('with invalid signature', () => {
      let v: number, r: string, s: string, deadline: BigNumber;

      context('with reused signature', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(boost, holder, spender, amount));
          await boost.permit(holder.address, spender.address, amount, deadline, v, r, s);
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature for other holder', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(boost, spender, spender, amount));
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature for other spender', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(boost, holder, holder, amount));
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature for other amount', () => {
        beforeEach(async () => {
          ({ v, r, s, deadline } = await signPermit(boost, holder, spender, amount.add(1)));
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature for other token', () => {
        beforeEach(async () => {
          const otherToken = await deploy('v2-solidity-utils/ERC20PermitMock', { args: ['Token', 'TKN'] });

          ({ v, r, s, deadline } = await signPermit(otherToken, holder, spender, amount));
        });

        itRevertsWithInvalidSignature();
      });

      context('with signature with invalid nonce', () => {
        beforeEach(async () => {
          const currentNonce = await boost.nonces(holder.address);
          ({ v, r, s, deadline } = await signPermit(boost, holder, spender, amount, MAX_DEADLINE, currentNonce.add(1)));
        });

        itRevertsWithInvalidSignature();
      });

      context('with expired deadline', () => {
        beforeEach(async () => {
          const now = await currentTimestamp();

          ({ v, r, s, deadline } = await signPermit(boost, holder, spender, amount, now.sub(1)));
        });

        itRevertsWithInvalidSignature('EXPIRED_SIGNATURE');
      });

      function itRevertsWithInvalidSignature(reason?: string) {
        it('reverts', async () => {
          await expect(boost.permit(holder.address, spender.address, amount, deadline, v, r, s)).to.be.revertedWith(
            reason ?? 'INVALID_SIGNATURE'
          );
        });
      }
    });
  });
});
