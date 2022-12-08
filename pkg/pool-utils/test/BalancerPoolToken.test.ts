import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('BalancerPoolToken', () => {
  let token: Contract;
  let holder: SignerWithAddress, spender: SignerWithAddress, recipient: SignerWithAddress, vault: SignerWithAddress;

  before('setup signers', async () => {
    [, holder, spender, recipient, vault] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token', async () => {
    token = await deploy('MockBalancerPoolToken', { args: ['Token', 'TKN', vault.address] });
  });

  describe('allowance', () => {
    it('is infinite for the vault', async () => {
      expect(await token.allowance(holder.address, vault.address)).to.equal(MAX_UINT256);
    });
  });

  describe('transfer from', () => {
    const amount = bn(10e18);

    const itHandlesTransferFromsProperly = (recipientAddress?: string) => {
      let to: string;

      beforeEach('define recipient address', () => {
        to = recipientAddress || recipient.address;
      });

      enum SendFrom {
        SPENDER,
        HOLDER,
        VAULT,
      }

      const itTransfersTokensProperly = (sendFrom?: SendFrom) => {
        let signer: SignerWithAddress;

        beforeEach('define spender address', () => {
          signer =
            (sendFrom ?? SendFrom.SPENDER) == SendFrom.HOLDER ? holder : sendFrom == SendFrom.SPENDER ? spender : vault;
        });

        describe('when the token holder has enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await token.mint(holder.address, amount);
          });

          it('transfers the requested amount', async () => {
            const previousSenderBalance = await token.balanceOf(holder.address);
            const previousRecipientBalance = await token.balanceOf(to);

            await token.connect(signer).transferFrom(holder.address, to, amount);

            const currentSenderBalance = await token.balanceOf(holder.address);
            expect(currentSenderBalance).to.equal(previousSenderBalance.sub(amount));

            const currentRecipientBalance = await token.balanceOf(to);
            expect(currentRecipientBalance).to.equal(previousRecipientBalance.add(amount));
          });

          it('does not affect the supply', async () => {
            const previousSupply = await token.totalSupply();

            await token.connect(signer).transferFrom(holder.address, to, amount);

            const currentSupply = await token.totalSupply();
            expect(currentSupply).to.equal(previousSupply);
          });

          it('does not affect the spender balance', async () => {
            const previousSpenderBalance = await token.balanceOf(spender.address);

            await token.connect(signer).transferFrom(holder.address, to, amount);

            const currentSpenderBalance = await token.balanceOf(spender.address);
            expect(currentSpenderBalance).to.equal(previousSpenderBalance);
          });

          it('emits a transfer event', async () => {
            const tx = await token.connect(signer).transferFrom(holder.address, to, amount);
            const receipt = await tx.wait();

            expectTransferEvent(receipt, { from: holder.address, to, value: amount }, token);
          });
        });

        describe('when the token holder does not have enough balance', () => {
          it('reverts', async () => {
            await expect(token.connect(signer).transferFrom(holder.address, to, amount)).to.be.revertedWith(
              'ERC20_TRANSFER_EXCEEDS_BALANCE'
            );
          });
        });
      };

      describe('when the spender is the token holder', () => {
        itTransfersTokensProperly(SendFrom.HOLDER);

        describe('when the token holder has enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await token.mint(holder.address, amount);
          });

          it('does not emit an approval event', async () => {
            const tx = await token.connect(holder).transferFrom(holder.address, to, amount);
            const receipt = await tx.wait();

            expectEvent.notEmitted(receipt, 'Approval');
          });
        });
      });

      describe('when the spender has enough approved balance', () => {
        sharedBeforeEach('approve allowance', async () => {
          await token.connect(holder).approve(spender.address, amount);
        });

        itTransfersTokensProperly(SendFrom.SPENDER);

        describe('when the token holder has enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await token.mint(holder.address, amount);
          });

          it('decreases the spender allowance', async () => {
            const previousAllowance = await token.allowance(holder.address, spender.address);

            await token.connect(spender).transferFrom(holder.address, to, amount);

            const currentAllowance = await token.allowance(holder.address, spender.address);
            expect(currentAllowance).to.be.equal(previousAllowance.sub(amount));
          });

          it('emits an approval event', async () => {
            const tx = await token.connect(spender).transferFrom(holder.address, to, amount);
            const receipt = await tx.wait();

            expectEvent.inReceipt(receipt, 'Approval', {
              owner: holder.address,
              spender: spender.address,
              value: await token.allowance(holder.address, spender.address),
            });
          });
        });
      });

      describe('when the spender has an infinite approved balance', () => {
        sharedBeforeEach('approve allowance', async () => {
          await token.connect(holder).approve(spender.address, MAX_UINT256);
        });

        itTransfersTokensProperly(SendFrom.SPENDER);

        describe('when the token holder has enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await token.mint(holder.address, amount);
          });

          it('does not decrease the spender allowance', async () => {
            const previousAllowance = await token.allowance(holder.address, spender.address);

            await token.connect(spender).transferFrom(holder.address, to, amount);

            const currentAllowance = await token.allowance(holder.address, spender.address);
            expect(currentAllowance).to.be.equal(previousAllowance);
          });

          it('does not emit an approval event', async () => {
            const tx = await token.connect(spender).transferFrom(holder.address, to, amount);
            const receipt = await tx.wait();

            expectEvent.notEmitted(receipt, 'Approval');
          });
        });
      });

      describe('when the spender is the vault', () => {
        itTransfersTokensProperly(SendFrom.VAULT);

        describe('when the token holder has enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await token.mint(holder.address, amount);
          });

          it('does not decrease the spender allowance', async () => {
            const previousAllowance = await token.allowance(holder.address, vault.address);

            await token.connect(vault).transferFrom(holder.address, to, amount);

            const currentAllowance = await token.allowance(holder.address, vault.address);
            expect(currentAllowance).to.be.equal(previousAllowance);
          });

          it('does not emit an approval event', async () => {
            const tx = await token.connect(vault).transferFrom(holder.address, to, amount);
            const receipt = await tx.wait();

            expectEvent.notEmitted(receipt, 'Approval');
          });
        });
      });

      describe('when the spender does not have enough approved balance', () => {
        sharedBeforeEach('approve some allowance', async () => {
          await token.connect(holder).approve(spender.address, amount.sub(1));
        });

        describe('when the token holder has enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await token.mint(holder.address, amount);
          });

          it('reverts', async () => {
            await expect(token.connect(spender).transferFrom(holder.address, to, amount)).to.be.revertedWith(
              'ERC20_TRANSFER_EXCEEDS_ALLOWANCE'
            );
          });
        });

        describe('when the token holder does not have enough balance', () => {
          it('reverts', async () => {
            await expect(token.connect(spender).transferFrom(holder.address, to, amount)).to.be.revertedWith(
              'ERC20_TRANSFER_EXCEEDS_ALLOWANCE'
            );
          });
        });
      });
    };

    describe('when the recipient is not the zero address', () => {
      itHandlesTransferFromsProperly();
    });

    describe('when the recipient is the zero address', () => {
      beforeEach('mint and approve', async () => {
        await token.mint(holder.address, amount);
        await token.connect(holder).approve(spender.address, amount);
      });

      it('reverts', async () => {
        await expect(token.connect(spender).transferFrom(holder.address, ZERO_ADDRESS, amount)).to.be.revertedWith(
          'ERC20_TRANSFER_TO_ZERO_ADDRESS'
        );
      });
    });
  });

  describe('decreaseAllowance', () => {
    const amount = bn(1e18);

    const itDecreasesTheAllowance = (amount: BigNumberish, spenderAddress?: string) => {
      let to: string;

      beforeEach('define spender address', () => {
        to = spenderAddress || spender.address;
      });

      it('decreases the allowance by the requested amount', async () => {
        const previousAllowance = await token.allowance(holder.address, to);
        const expectedAllowance = previousAllowance > amount ? previousAllowance.sub(amount) : 0;

        await token.connect(holder).decreaseAllowance(to, amount);

        const currentAllowance = await token.allowance(holder.address, to);
        expect(currentAllowance).to.equal(expectedAllowance);
      });

      it('emits an approval event', async () => {
        const previousAllowance = await token.allowance(holder.address, to);
        const expectedAllowance = previousAllowance > amount ? previousAllowance.sub(amount) : 0;

        const receipt = await (await token.connect(holder).decreaseAllowance(to, amount)).wait();

        expectEvent.inReceipt(receipt, 'Approval', {
          owner: holder.address,
          spender: to,
          value: expectedAllowance,
        });
      });
    };

    const itHandlesApprovalsProperly = (spenderAddress?: string) => {
      describe('when the sender has enough balance', () => {
        sharedBeforeEach('mint tokens', async () => {
          await token.mint(holder.address, amount);
        });

        describe('when there was no approved amount before', () => {
          itDecreasesTheAllowance(amount, spenderAddress);
        });

        describe('when the spender had an approved amount', () => {
          sharedBeforeEach('approve allowance', async () => {
            await token.connect(holder).approve(spenderAddress || spender.address, amount.mul(2));
          });

          itDecreasesTheAllowance(amount, spenderAddress);
        });
      });

      describe('when the sender does not have enough balance', () => {
        describe('when there was no approved amount before', () => {
          itDecreasesTheAllowance(amount, spenderAddress);
        });

        describe('when the spender had an approved amount', () => {
          sharedBeforeEach('approve allowance', async () => {
            await token.connect(holder).approve(spenderAddress || spender.address, amount.mul(2));
          });

          itDecreasesTheAllowance(amount, spenderAddress);
        });
      });
    };

    describe('when the spender is not the zero address', () => {
      itHandlesApprovalsProperly();
    });

    describe('when the spender is the zero address', () => {
      itHandlesApprovalsProperly(ZERO_ADDRESS);
    });
  });
});
