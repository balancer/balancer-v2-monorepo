import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from '@ethersproject/contracts';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('EOASignaturesValidator', () => {
  let validator: Contract;
  let user: SignerWithAddress;

  before('setup signers', async () => {
    [, user] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy validator', async () => {
    validator = await deploy('EOASignaturesValidatorMock');
  });

  let nonce: BigNumberish;
  const AMOUNT = 42;

  async function getSignature(amount?: BigNumberish): Promise<string> {
    const { chainId } = await validator.provider.getNetwork();

    const domain = {
      name: 'EOA Signatures Validator Mock',
      version: '1',
      chainId,
      verifyingContract: validator.address,
    };

    const types = {
      Authenticate: [
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    };

    const values = {
      amount: (amount ?? AMOUNT).toString(),
      nonce: nonce.toString(),
    };

    return user._signTypedData(domain, types, values);
  }

  const setNonceOffset = (offset = 0) => {
    beforeEach(`set nonce with offset ${offset}`, async () => {
      // mock at least one nonce in case we want to test with an old one
      await validator.increaseNonce(user.address);
      const nextNonce = await validator.getNextNonce(user.address);
      nonce = nextNonce.add(offset);
    });
  };

  describe('without deadline', () => {
    context('when the signature is malformed', () => {
      it('reverts', async () => {
        // The signature must be 65 bytes long

        await expect(validator.authenticatedCall(ZERO_ADDRESS, 0, '0x'.concat('00'.repeat(64)))).to.be.revertedWith(
          'MALFORMED_SIGNATURE'
        );

        await expect(validator.authenticatedCall(ZERO_ADDRESS, 0, '0x'.concat('00'.repeat(66)))).to.be.revertedWith(
          'MALFORMED_SIGNATURE'
        );
      });
    });

    context('when the signature is well formed', () => {
      const itReverts = (reason?: string) => {
        it('reverts', async () => {
          await expect(validator.authenticatedCall(user.address, AMOUNT, await getSignature())).to.be.revertedWith(
            reason ?? 'INVALID_SIGNATURE'
          );
        });
      };

      context('when the given nonce is the next one', () => {
        setNonceOffset(0);

        context('when the signature is for other data', () => {
          it('reverts', async () => {
            await expect(
              validator.authenticatedCall(user.address, AMOUNT, await getSignature(AMOUNT + 1))
            ).to.be.revertedWith('INVALID_SIGNATURE');
          });
        });

        context('when the signature is for the correct data', () => {
          it('allows the sender', async () => {
            const tx = await validator.authenticatedCall(user.address, AMOUNT, await getSignature());

            expectEvent.inIndirectReceipt(await tx.wait(), validator.interface, 'Authenticated');
          });

          it('increases the nonce of the user', async () => {
            const previousNonce = await validator.getNextNonce(user.address);

            await validator.authenticatedCall(user.address, AMOUNT, await getSignature());

            const nextNonce = await validator.getNextNonce(user.address);
            expect(nextNonce).to.be.equal(previousNonce.add(1));
          });

          it('does not allow using the same signature twice', async () => {
            await validator.authenticatedCall(user.address, AMOUNT, await getSignature());

            await expect(validator.authenticatedCall(user.address, AMOUNT, await getSignature())).to.be.revertedWith(
              'INVALID_SIGNATURE'
            );
          });
        });
      });

      context('when the given nonce is a past one', () => {
        setNonceOffset(-1);

        itReverts();
      });

      context('when the given nonce is a future one', () => {
        setNonceOffset(1);
        itReverts();
      });
    });
  });

  describe('with deadline', () => {
    let deadline: BigNumberish;

    const setDeadlineOffset = (offset = 0) => {
      beforeEach(`set deadline with offset ${offset}`, async () => {
        const now = await currentTimestamp();
        deadline = now.add(offset);
      });
    };

    context('when the signature is malformed', () => {
      it('reverts', async () => {
        // The signature must be 65 bytes long

        await expect(
          validator.authenticatedCallWithDeadline(ZERO_ADDRESS, 0, '0x'.concat('00'.repeat(64)), 0)
        ).to.be.revertedWith('MALFORMED_SIGNATURE');

        await expect(
          validator.authenticatedCallWithDeadline(ZERO_ADDRESS, 0, '0x'.concat('00'.repeat(66)), 0)
        ).to.be.revertedWith('MALFORMED_SIGNATURE');
      });
    });

    context('when the signature is well formed', () => {
      const itReverts = (reason?: string) => {
        it('reverts', async () => {
          await expect(
            validator.authenticatedCallWithDeadline(user.address, AMOUNT, await getSignature(), deadline)
          ).to.be.revertedWith(reason ?? 'INVALID_SIGNATURE');
        });
      };

      context('when the given nonce is the next one', () => {
        setNonceOffset(0);

        context('when the deadline is in the past', () => {
          setDeadlineOffset(-100);

          itReverts('EXPIRED_SIGNATURE');
        });

        context('when the deadline is in the future', () => {
          setDeadlineOffset(60 * 60);

          context('when the signature is for other data', () => {
            it('reverts', async () => {
              await expect(
                validator.authenticatedCallWithDeadline(user.address, AMOUNT, await getSignature(AMOUNT + 1), deadline)
              ).to.be.revertedWith('INVALID_SIGNATURE');
            });
          });

          context('when the signature is for the correct data', () => {
            it('allows the sender', async () => {
              const tx = await validator.authenticatedCallWithDeadline(
                user.address,
                AMOUNT,
                await getSignature(),
                deadline
              );

              expectEvent.inReceipt(await tx.wait(), 'Authenticated');
            });

            it('increases the nonce of the user', async () => {
              const previousNonce = await validator.getNextNonce(user.address);

              await validator.authenticatedCallWithDeadline(user.address, AMOUNT, await getSignature(), deadline);

              const nextNonce = await validator.getNextNonce(user.address);
              expect(nextNonce).to.be.equal(previousNonce.add(1));
            });

            it('does not allow using the same signature twice', async () => {
              await validator.authenticatedCallWithDeadline(user.address, AMOUNT, await getSignature(), deadline);

              await expect(
                validator.authenticatedCallWithDeadline(user.address, AMOUNT, await getSignature(), deadline)
              ).to.be.revertedWith('INVALID_SIGNATURE');
            });
          });
        });
      });

      context('when the given nonce is a past one', () => {
        setNonceOffset(-1);

        context('when the deadline is in the past', () => {
          setDeadlineOffset(-100);

          itReverts();
        });

        context('when the deadline is in the future', () => {
          setDeadlineOffset(60 * 60);

          itReverts();
        });
      });

      context('when the given nonce is a future one', () => {
        setNonceOffset(1);

        context('when the deadline is in the past', () => {
          setDeadlineOffset(-100);

          itReverts();
        });

        context('when the deadline is in the future', () => {
          setDeadlineOffset(60 * 60);

          itReverts();
        });
      });
    });
  });
});
