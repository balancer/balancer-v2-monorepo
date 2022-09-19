import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BalancerMinterAuthorization } from '@balancer-labs/balancer-js';
import { currentTimestamp, HOUR } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('BalancerMinter', () => {
  let minterContract: Contract;
  let minter: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, minter, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    const balancerTokenAdmin = await deploy('BalancerTokenAdmin', { args: [ZERO_ADDRESS, ZERO_ADDRESS] });
    minterContract = await deploy('BalancerMinter', { args: [balancerTokenAdmin.address, ZERO_ADDRESS] });
  });

  describe('set minter approval with signature', () => {
    context('with a valid signature', () => {
      async function expectSetApproval(approval: boolean): Promise<void> {
        const { v, r, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
          minterContract,
          minter,
          approval,
          user
        );

        const receipt = await (
          await minterContract.setMinterApprovalWithSignature(minter.address, approval, user.address, deadline, v, r, s)
        ).wait();

        expect(await minterContract.getMinterApproval(minter.address, user.address)).to.equal(approval);
        expectEvent.inReceipt(receipt, 'MinterApprovalSet', {
          minter: minter.address,
          user: user.address,
          approval,
        });
      }

      it('grants approval to a minter', async () => {
        await expectSetApproval(true);
      });

      it('removes approval from a minter', async () => {
        await expectSetApproval(false);
      });

      it('rejects replayed signatures', async () => {
        const { v, r, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
          minterContract,
          minter,
          false,
          user
        );

        await minterContract.setMinterApprovalWithSignature(minter.address, false, user.address, deadline, v, r, s);

        await expect(
          minterContract.setMinterApprovalWithSignature(minter.address, true, user.address, deadline, v, r, s)
        ).to.be.revertedWith('INVALID_SIGNATURE');
      });
    });

    context('with an invalid signature', () => {
      it('rejects expired signatures', async () => {
        const deadline = (await currentTimestamp()).sub(HOUR);
        const { v, r, s } = await BalancerMinterAuthorization.signSetMinterApproval(
          minterContract,
          minter,
          true,
          user,
          deadline
        );

        await expect(
          minterContract.setMinterApprovalWithSignature(minter.address, true, user.address, deadline, v, r, s)
        ).to.be.revertedWith('EXPIRED_SIGNATURE');
      });

      it('rejects signatures from other users', async () => {
        const { v, r, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
          minterContract,
          minter,
          true,
          other
        );

        await expect(
          minterContract.setMinterApprovalWithSignature(minter.address, true, user.address, deadline, v, r, s)
        ).to.be.revertedWith('INVALID_SIGNATURE');
      });

      it('rejects signatures for other minters', async () => {
        const { v, r, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
          minterContract,
          other,
          true,
          user
        );

        await expect(
          minterContract.setMinterApprovalWithSignature(minter.address, true, user.address, deadline, v, r, s)
        ).to.be.revertedWith('INVALID_SIGNATURE');
      });

      it('rejects approve signature for opposite approval', async () => {
        async function expectRejectIncorrectApproval(approval: boolean): Promise<void> {
          const { v, r, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
            minterContract,
            minter,
            !approval,
            user
          );

          await expect(
            minterContract.setMinterApprovalWithSignature(minter.address, approval, user.address, deadline, v, r, s)
          ).to.be.revertedWith('INVALID_SIGNATURE');
        }

        await expectRejectIncorrectApproval(true);
        await expectRejectIncorrectApproval(false);
      });

      it('rejects signatures for the zero address', async () => {
        const { v, r, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
          minterContract,
          minter,
          true,
          user
        );

        await expect(
          minterContract.setMinterApprovalWithSignature(minter.address, true, ZERO_ADDRESS, deadline, v, r, s)
        ).to.be.revertedWith('INVALID_SIGNATURE');
      });

      it('rejects invalid signatures for the zero address', async () => {
        const { v, s, deadline } = await BalancerMinterAuthorization.signSetMinterApproval(
          minterContract,
          minter,
          true,
          user
        );

        await expect(
          minterContract.setMinterApprovalWithSignature(
            minter.address,
            true,
            ZERO_ADDRESS,
            deadline,
            v,
            '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
            s
          )
        ).to.be.revertedWith('INVALID_SIGNATURE');
      });
    });
  });
});
