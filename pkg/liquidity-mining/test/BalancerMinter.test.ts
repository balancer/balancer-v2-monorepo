import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BalancerMinterAuthorization } from '@balancer-labs/balancer-js';
import { currentTimestamp, HOUR } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { randomAddress } from '@balancer-labs/v2-helpers/src/constants';
import { range } from 'lodash';

describe('BalancerMinter', () => {
  let minterContract: Contract;
  let BAL: Contract;
  let minter: SignerWithAddress, admin: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, minter, admin, user, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    BAL = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
    minterContract = await deploy('MockBalancerMinter', { args: [BAL.address] });
  });

  describe('getters', () => {
    it('returns Balancer token', async () => {
      expect(await minterContract.getBalancerToken()).to.be.eq(BAL.address);
    });
  });

  describe('minter approval', () => {
    let receipt: ContractReceipt;

    sharedBeforeEach(async () => {
      receipt = await (await minterContract.connect(user).setMinterApproval(minter.address, true)).wait();
    });

    it('grants approval to a minter', async () => {
      expect(await minterContract.getMinterApproval(minter.address, user.address)).to.be.true;
      expect(await minterContract.allowed_to_mint_for(minter.address, user.address)).to.be.true;
    });

    it('emits an event', async () => {
      expectEvent.inReceipt(receipt, 'MinterApprovalSet', {
        user: user.address,
        minter: minter.address,
        approval: true,
      });
    });

    it('removes approval from a minter', async () => {
      await minterContract.connect(user).setMinterApproval(minter.address, false);
      expect(await minterContract.getMinterApproval(minter.address, user.address)).to.be.false;
      expect(await minterContract.allowed_to_mint_for(minter.address, user.address)).to.be.false;
    });

    it('does not grant approval to others', async () => {
      expect(await minterContract.getMinterApproval(other.address, user.address)).to.be.false;
      expect(await minterContract.allowed_to_mint_for(other.address, user.address)).to.be.false;
    });

    it('does not grant approval for others', async () => {
      expect(await minterContract.getMinterApproval(minter.address, other.address)).to.be.false;
      expect(await minterContract.allowed_to_mint_for(minter.address, other.address)).to.be.false;
    });

    describe('toggle minter approval', () => {
      sharedBeforeEach(async () => {
        expect(await minterContract.getMinterApproval(minter.address, user.address)).to.be.true;
        receipt = await (await minterContract.connect(user).toggle_approve_mint(minter.address)).wait();
      });

      it('toggles minter approval', async () => {
        it('grants approval to a minter', async () => {
          expect(await minterContract.getMinterApproval(minter.address, user.address)).to.be.false;
          expect(await minterContract.allowed_to_mint_for(minter.address, user.address)).to.be.false;
        });

        it('emits an event', async () => {
          expectEvent.inReceipt(receipt, 'MinterApprovalSet', {
            user: user.address,
            minter: minter.address,
            approval: false,
          });
        });
      });
    });
  });

  describe('mint / mintFor', () => {
    let mintFunction: () => Promise<ContractReceipt>;
    let mintStaticFunction: () => Promise<BigNumber>;

    const expectedMintForReturn = 159;
    const gauge = ANY_ADDRESS;

    function itCallsVirtualHooks() {
      it('calls internal _mintFor virtual hook', async () => {
        const receipt = await mintFunction();
        expectEvent.inReceipt(receipt, 'MintFor', { gauge, user: user.address });
      });

      it('returns the same value as the internal _mintFor virtual hook', async () => {
        expect(await mintStaticFunction()).to.be.eq(expectedMintForReturn);
      });
    }

    sharedBeforeEach(async () => {
      await minterContract.setMockMintFor(expectedMintForReturn);
    });

    describe('mint', () => {
      sharedBeforeEach(async () => {
        mintFunction = async () => await (await minterContract.connect(user).mint(gauge)).wait();
        mintStaticFunction = async () => await minterContract.connect(user).callStatic.mint(gauge);
      });

      itCallsVirtualHooks();
    });

    describe('mintFor', () => {
      sharedBeforeEach(async () => {
        mintFunction = async () => await (await minterContract.connect(minter).mintFor(gauge, user.address)).wait();
        mintStaticFunction = async () => await minterContract.connect(minter).callStatic.mintFor(gauge, user.address);
      });

      context('when the caller is not allowed', () => {
        it('reverts', async () => {
          await expect(mintFunction()).to.be.revertedWith('Caller not allowed to mint for user');
        });
      });

      context('when caller is allowed', () => {
        sharedBeforeEach(async () => {
          await minterContract.connect(user).setMinterApproval(minter.address, true);
        });

        itCallsVirtualHooks();
      });
    });

    describe('mint_for', () => {
      sharedBeforeEach(async () => {
        mintFunction = async () => await (await minterContract.connect(minter).mint_for(gauge, user.address)).wait();
        mintStaticFunction = async () => await minterContract.connect(minter).callStatic.mint_for(gauge, user.address);
      });

      context('when the caller is not allowed', () => {
        it('does not call _mintFor virtual hook', async () => {
          const receipt = await mintFunction();
          expectEvent.notEmitted(receipt, 'MintFor');
        });
      });

      context('when caller is allowed', () => {
        sharedBeforeEach(async () => {
          await minterContract.connect(user).setMinterApproval(minter.address, true);
        });

        it('calls internal _mintFor virtual hook', async () => {
          const receipt = await mintFunction();
          expectEvent.inReceipt(receipt, 'MintFor', { gauge, user: user.address });
        });

        it('returns nothing', async () => {
          expect(await mintStaticFunction()).to.be.deep.eq([]);
        });
      });
    });
  });

  describe('mintMany / mintManyFor', () => {
    let mintManyFunction: () => Promise<ContractReceipt>;
    let mintManyStaticFunction: () => Promise<BigNumber>;
    let gauges: string[];

    const expectedMintManyForReturn = 83;

    function itCallsVirtualHooks() {
      it('calls internal _mintForMany virtual hook', async () => {
        const receipt = await mintManyFunction();
        expectEvent.inReceipt(receipt, 'MintForMany', { gauges, user: user.address });
      });

      it('returns the same value as the internal _mintForMany virtual hook', async () => {
        expect(await mintManyStaticFunction()).to.be.eq(expectedMintManyForReturn);
      });
    }

    sharedBeforeEach(async () => {
      gauges = await Promise.all(range(5).map(randomAddress));
      await minterContract.setMockMintForMany(expectedMintManyForReturn);
    });

    describe('mintMany', () => {
      sharedBeforeEach(async () => {
        mintManyFunction = async () => await (await minterContract.connect(user).mintMany(gauges)).wait();
        mintManyStaticFunction = async () => await minterContract.connect(user).callStatic.mintMany(gauges);
      });

      itCallsVirtualHooks();
    });

    describe('mintManyFor', () => {
      sharedBeforeEach(async () => {
        mintManyFunction = async () =>
          await (await minterContract.connect(minter).mintManyFor(gauges, user.address)).wait();
        mintManyStaticFunction = async () =>
          await minterContract.connect(minter).callStatic.mintManyFor(gauges, user.address);
      });

      context('when the caller is not allowed', () => {
        it('reverts', async () => {
          await expect(mintManyFunction()).to.be.revertedWith('Caller not allowed to mint for user');
        });
      });

      context('when caller is allowed', () => {
        sharedBeforeEach(async () => {
          await minterContract.connect(user).setMinterApproval(minter.address, true);
        });

        itCallsVirtualHooks();
      });
    });

    describe('mint_many', () => {
      let gauges8: string[];

      sharedBeforeEach(async () => {
        mintManyFunction = async () => await (await minterContract.connect(user).mint_many(gauges8)).wait();
        mintManyStaticFunction = async () => await minterContract.connect(user).callStatic.mint_many(gauges8);
        gauges8 = await Promise.all(range(8).map(randomAddress)); // mint_many accepts a fixed length array of 8.
      });

      it('calls internal _mintFor virtual hook for each gauge', async () => {
        const receipt = await mintManyFunction();
        for (const gauge of gauges8) {
          expectEvent.inReceipt(receipt, 'MintFor', { gauge, user: user.address });
        }
      });
    });
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

  describe('_setMinted', () => {
    const expectedMintedValue = 7895;
    const gaugeAddress = ANY_ADDRESS;
    const otherGaugeAddress = randomAddress();
    let receipt: ContractReceipt;

    sharedBeforeEach(async () => {
      expect(await minterContract.minted(user.address, gaugeAddress)).to.be.eq(0);
      receipt = await (await minterContract.setMinted(user.address, gaugeAddress, expectedMintedValue)).wait();
    });

    it('updates minted value for given user and gauge', async () => {
      expect(await minterContract.minted(user.address, gaugeAddress)).to.be.eq(expectedMintedValue);
    });

    it('emits an event', async () => {
      expectEvent.inReceipt(receipt, 'Minted', {
        recipient: user.address,
        gauge: gaugeAddress,
        minted: expectedMintedValue,
      });
    });

    it('does not update minted value for other user', async () => {
      expect(await minterContract.minted(other.address, gaugeAddress)).to.be.eq(0);
    });

    it('does not update minted value for other gauge', async () => {
      expect(await minterContract.minted(user.address, otherGaugeAddress)).to.be.eq(0);
    });
  });
});
