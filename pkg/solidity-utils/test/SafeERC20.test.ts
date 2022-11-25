import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('SafeERC20', () => {
  let erc20: Contract, usdt: Contract, falseApproveERC20: Contract, safeERC20: Contract, brokenERC20: Contract;
  let token: Contract;
  let spender: SignerWithAddress;

  before('setup signers', async () => {
    [, spender] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy contracts', async () => {
    erc20 = await deploy('ERC20Mock', { args: ['Token', 'TKN'] });
    usdt = await deploy('USDTMock');
    falseApproveERC20 = await deploy('ERC20FalseApprovalMock', { args: ['Token', 'TKN'] });
    brokenERC20 = await deploy('BrokenERC20Mock', { args: ['Token', 'TKN'] });

    safeERC20 = await deploy('SafeERC20Mock');
  });

  describe('safe approve', () => {
    function itApproves(amount: BigNumber) {
      context(`when new allowance is ${amount.toHexString().slice(0, 8)}`, () => {
        it('approves the requested amount', async () => {
          await safeERC20.safeApprove(token.address, spender.address, amount);

          const currentAllowance = await token.allowance(safeERC20.address, spender.address);
          expect(currentAllowance).to.equal(amount);
        });

        it('emits an approval event', async () => {
          const tx = await safeERC20.safeApprove(token.address, spender.address, amount);

          expectEvent.inIndirectReceipt(await tx.wait(), token.interface, 'Approval', {
            owner: safeERC20.address,
            spender: spender.address,
            value: amount,
          });
        });
      });
    }

    context('without existing allowance', () => {
      context('with a regular ERC20 token', () => {
        sharedBeforeEach(() => {
          token = erc20;
        });

        itApproves(fp(0));
        itApproves(fp(1));
        itApproves(MAX_UINT256);
      });

      context('with USDT mock', () => {
        sharedBeforeEach(() => {
          token = usdt;
        });

        itApproves(fp(0));
        itApproves(fp(1));
        itApproves(MAX_UINT256);
      });

      context('when approve returns false', () => {
        sharedBeforeEach(() => {
          token = falseApproveERC20;
        });

        it('reverts', async () => {
          await expect(safeERC20.safeApprove(token.address, spender.address, fp(1))).to.be.revertedWith(
            'SAFE_ERC20_CALL_FAILED'
          );
        });
      });

      context('when approve reverts', () => {
        sharedBeforeEach(() => {
          token = brokenERC20;
        });

        it('reverts respecting the original reason', async () => {
          await expect(safeERC20.safeApprove(token.address, spender.address, fp(1))).to.be.revertedWith('BROKEN_TOKEN');
        });
      });
    });

    context('with existing allowance', () => {
      // This test is only relevant for the USDT mock.
      sharedBeforeEach(async () => {
        token = usdt;
        await token.setAllowance(safeERC20.address, spender.address, fp(123));
      });

      itApproves(fp(0));
      itApproves(fp(1));
      itApproves(MAX_UINT256);
    });
  });
});
