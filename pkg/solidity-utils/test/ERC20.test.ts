import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('ERC20', () => {
  let token: Contract;
  let holder: SignerWithAddress, spender: SignerWithAddress, recipient: SignerWithAddress, other: SignerWithAddress;

  before('setup signers', async () => {
    [, holder, spender, recipient, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy token', async () => {
    token = await deploy('ERC20Mock', { args: ['Token', 'TKN'] });
  });

  describe('info', () => {
    it('setups the name properly', async () => {
      expect(await token.name()).to.be.equal('Token');
    });

    it('setups the symbol properly', async () => {
      expect(await token.symbol()).to.be.equal('TKN');
    });

    it('setups the decimals properly', async () => {
      expect(await token.decimals()).to.be.equal(18);
    });
  });

  describe('total supply', () => {
    context('when there is no supply', () => {
      it('returns zero', async () => {
        expect(await token.totalSupply()).to.be.equal(0);
      });
    });

    context('when there is some supply', () => {
      const amount = bn(10e18);

      beforeEach('mint tokens', async () => {
        await token.mint(holder.address, amount);
        await token.mint(holder.address, amount);
      });

      it('returns the existing supply', async () => {
        expect(await token.totalSupply()).to.be.equal(amount.mul(2));
      });
    });
  });

  describe('balanceOf', () => {
    context('when the requested account has no tokens', () => {
      it('returns zero', async () => {
        expect(await token.balanceOf(other.address)).to.be.equal(0);
      });
    });

    context('when the requested account has some tokens', () => {
      const balance = bn(10e18);

      sharedBeforeEach('mint tokens', async () => {
        await token.mint(holder.address, balance);
      });

      it('returns the total amount of tokens', async () => {
        expect(await token.balanceOf(holder.address)).to.be.equal(balance);
      });
    });
  });

  describe('transfer', () => {
    const itTransfersTheTokens = (amount: BigNumberish, recipientAddress?: string) => {
      let to: string;

      beforeEach('define recipient address', () => {
        to = recipientAddress || recipient.address;
      });

      it('transfers the requested amount', async () => {
        const previousSenderBalance = await token.balanceOf(holder.address);
        const previousRecipientBalance = await token.balanceOf(to);

        await token.connect(holder).transfer(to, amount);

        const currentSenderBalance = await token.balanceOf(holder.address);
        expect(currentSenderBalance).to.equal(previousSenderBalance.sub(amount));

        const currentRecipientBalance = await token.balanceOf(to);
        expect(currentRecipientBalance).to.equal(previousRecipientBalance.add(amount));
      });

      it('does not affect the supply', async () => {
        const previousSupply = await token.totalSupply();

        await token.connect(holder).transfer(to, amount);

        const currentSupply = await token.totalSupply();
        expect(currentSupply).to.equal(previousSupply);
      });

      it('emits a transfer event', async () => {
        const receipt = await (await token.connect(holder).transfer(to, amount)).wait();

        expectEvent.inReceipt(receipt, 'Transfer', { from: holder.address, to, value: amount });
      });
    };

    const itHandlesTransfersProperly = (recipientAddress?: string) => {
      context('when the given amount is zero', () => {
        const amount = bn(0);

        itTransfersTheTokens(amount, recipientAddress);
      });

      context('when the given amount is greater than zero', () => {
        const amount = bn(10e18);

        context('when the sender does not have enough balance', () => {
          it('reverts', async () => {
            await expect(
              token.connect(holder).transfer(recipientAddress || recipient.address, amount)
            ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
          });
        });

        context('when the sender has enough balance', () => {
          sharedBeforeEach('mint tokens', async () => {
            await token.mint(holder.address, amount);
          });

          itTransfersTheTokens(amount, recipientAddress);
        });
      });
    };

    context('when the recipient is not the zero address', () => {
      itHandlesTransfersProperly();
    });

    context('when the recipient is the zero address', () => {
      it('reverts', async () => {
        await expect(token.connect(holder).transfer(ZERO_ADDRESS, bn(0))).to.be.revertedWith(
          'ERC20_TRANSFER_TO_ZERO_ADDRESS'
        );
      });
    });
  });

  describe('transfer from', () => {
    const amount = bn(10e18);

    describe('when the token holder is not the zero address', () => {
      const itHandlesTransferFromsProperly = (recipientAddress?: string) => {
        let to: string;

        beforeEach('define recipient address', () => {
          to = recipientAddress || recipient.address;
        });

        describe('when the spender has enough approved balance', () => {
          sharedBeforeEach('approve allowance', async () => {
            await token.connect(holder).approve(spender.address, amount);
          });

          describe('when the token holder has enough balance', () => {
            sharedBeforeEach('mint tokens', async () => {
              await token.mint(holder.address, amount);
            });

            it('transfers the requested amount', async () => {
              const previousSenderBalance = await token.balanceOf(holder.address);
              const previousRecipientBalance = await token.balanceOf(to);

              await token.connect(spender).transferFrom(holder.address, to, amount);

              const currentSenderBalance = await token.balanceOf(holder.address);
              expect(currentSenderBalance).to.equal(previousSenderBalance.sub(amount));

              const currentRecipientBalance = await token.balanceOf(to);
              expect(currentRecipientBalance).to.equal(previousRecipientBalance.add(amount));
            });

            it('does not affect the supply', async () => {
              const previousSupply = await token.totalSupply();

              await token.connect(spender).transferFrom(holder.address, to, amount);

              const currentSupply = await token.totalSupply();
              expect(currentSupply).to.equal(previousSupply);
            });

            it('does not affect the spender balance', async () => {
              const previousSpenderBalance = await token.balanceOf(spender.address);

              await token.connect(spender).transferFrom(holder.address, to, amount);

              const currentSpenderBalance = await token.balanceOf(spender.address);
              expect(currentSpenderBalance).to.equal(previousSpenderBalance);
            });

            it('emits a transfer event', async () => {
              const tx = await token.connect(spender).transferFrom(holder.address, to, amount);
              const receipt = await tx.wait();

              expectEvent.inReceipt(receipt, 'Transfer', { from: holder.address, to, value: amount });
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

          describe('when the token holder does not have enough balance', () => {
            it('reverts', async () => {
              await expect(token.connect(spender).transferFrom(holder.address, to, amount)).to.be.revertedWith(
                'ERC20_TRANSFER_EXCEEDS_BALANCE'
              );
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
                'ERC20_TRANSFER_EXCEEDS_BALANCE'
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

    describe('when the token holder is the zero address', () => {
      it('reverts', async () => {
        await expect(token.connect(spender).transferFrom(ZERO_ADDRESS, recipient.address, amount)).to.be.revertedWith(
          'ERC20_TRANSFER_FROM_ZERO_ADDRESS'
        );
      });
    });
  });

  describe('approve', () => {
    const amount = bn(1e18);

    const itApprovesTheAllowance = (amount: BigNumberish, spenderAddress?: string) => {
      let to: string;

      beforeEach('define spender address', () => {
        to = spenderAddress || spender.address;
      });

      it('approves the requested amount', async () => {
        await token.connect(holder).approve(to, amount);

        const currentAllowance = await token.allowance(holder.address, to);
        expect(currentAllowance).to.equal(amount);
      });

      it('emits an approval event', async () => {
        const receipt = await (await token.connect(holder).approve(to, amount)).wait();

        expectEvent.inReceipt(receipt, 'Approval', {
          owner: holder.address,
          spender: to,
          value: amount,
        });
      });
    };

    const itHandlesApprovalsProperly = (spenderAddress?: string) => {
      describe('when the sender has enough balance', () => {
        sharedBeforeEach('mint tokens', async () => {
          await token.mint(holder.address, amount);
        });

        describe('when there was no approved amount before', () => {
          itApprovesTheAllowance(amount, spenderAddress);
        });

        describe('when the spender had an approved amount', () => {
          sharedBeforeEach('approve allowance', async () => {
            await token.connect(holder).approve(spenderAddress || spender.address, amount.mul(2));
          });

          itApprovesTheAllowance(amount, spenderAddress);
        });
      });

      describe('when the sender does not have enough balance', () => {
        describe('when there was no approved amount before', () => {
          itApprovesTheAllowance(amount, spenderAddress);
        });

        describe('when the spender had an approved amount', () => {
          sharedBeforeEach('approve allowance', async () => {
            await token.connect(holder).approve(spenderAddress || spender.address, amount.mul(2));
          });

          itApprovesTheAllowance(amount, spenderAddress);
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

  describe('mint', () => {
    const itMintsTheTokens = (amount: BigNumberish, recipientAddress?: string) => {
      let to: string;

      beforeEach('define recipient address', () => {
        to = recipientAddress || recipient.address;
      });

      it('mints the requested amount', async () => {
        const previousRecipientBalance = await token.balanceOf(to);

        await token.mint(to, amount);

        const currentRecipientBalance = await token.balanceOf(to);
        expect(currentRecipientBalance).to.equal(previousRecipientBalance.add(amount));
      });

      it('increases the supply', async () => {
        const previousSupply = await token.totalSupply();

        await token.mint(to, amount);

        const currentSupply = await token.totalSupply();
        expect(currentSupply).to.equal(previousSupply.add(amount));
      });

      it('emits a transfer event', async () => {
        const receipt = await (await token.mint(to, amount)).wait();

        expectEvent.inReceipt(receipt, 'Transfer', { from: ZERO_ADDRESS, to, value: amount });
      });
    };

    const itHandlesTransfersProperly = (recipientAddress?: string) => {
      context('when the given amount is zero', () => {
        const amount = bn(0);

        itMintsTheTokens(amount, recipientAddress);
      });

      context('when the given amount is greater than zero', () => {
        const amount = bn(10e18);

        itMintsTheTokens(amount, recipientAddress);
      });
    };

    context('when the recipient is not the zero address', () => {
      itHandlesTransfersProperly();
    });

    context('when the recipient is the zero address', () => {
      itHandlesTransfersProperly(ZERO_ADDRESS);
    });
  });

  describe('burn', () => {
    const itBurnsTheTokens = (amount: BigNumberish) => {
      it('burns the requested amount', async () => {
        const previousSenderBalance = await token.balanceOf(holder.address);

        await token.burn(holder.address, amount);

        const currentSenderBalance = await token.balanceOf(holder.address);
        expect(currentSenderBalance).to.equal(previousSenderBalance.sub(amount));
      });

      it('decreases the supply', async () => {
        const previousSupply = await token.totalSupply();

        await token.burn(holder.address, amount);

        const currentSupply = await token.totalSupply();
        expect(currentSupply).to.equal(previousSupply.sub(amount));
      });

      it('emits a transfer event', async () => {
        const receipt = await (await token.burn(holder.address, amount)).wait();

        expectEvent.inReceipt(receipt, 'Transfer', { from: holder.address, to: ZERO_ADDRESS, value: amount });
      });
    };

    context('when the given amount is zero', () => {
      const amount = bn(0);

      itBurnsTheTokens(amount);
    });

    context('when the given amount is greater than zero', () => {
      const amount = bn(10e18);

      context('when the sender does not have enough balance', () => {
        it('reverts', async () => {
          await expect(token.burn(holder.address, amount)).be.revertedWith('ERC20_BURN_EXCEEDS_BALANCE');
        });
      });

      context('when the sender has enough balance', () => {
        sharedBeforeEach('mint tokens', async () => {
          await token.mint(holder.address, amount);
        });

        itBurnsTheTokens(amount);
      });
    });
  });
});
