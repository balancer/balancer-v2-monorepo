import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy, deployedAt, getArtifact } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { fp, FP_100_PCT } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';

describe('ProtocolFeePercentagesProvider', function () {
  let admin: SignerWithAddress, authorized: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract, feesCollector: Contract;
  let provider: Contract;

  enum FeeType {
    Swap = 0,
    FlashLoan = 1,
    Yield = 2,
    AUM = 3,
  }

  const INVALID_FEE_TYPE = 1047;

  // Note that these two values are not passed - they're hardcoded into the ProtocolFeesCollector
  const MAX_SWAP_VALUE = fp(0.5);
  const MAX_FLASH_LOAN_VALUE = fp(0.01);

  const MAX_AUM_VALUE = fp(0.2);
  const MAX_YIELD_VALUE = fp(0.8);

  before(async () => {
    [, admin, authorized, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    ({ instance: vault, authorizer } = await Vault.create({ admin }));
    feesCollector = await deployedAt('v2-vault/ProtocolFeesCollector', await vault.getProtocolFeesCollector());
  });

  describe('construction', () => {
    it('reverts if the maximum yield value is too high', async () => {
      await expect(
        deploy('ProtocolFeePercentagesProvider', {
          args: [vault.address, FP_100_PCT.add(1), 0],
        })
      ).to.be.revertedWith('Invalid maximum fee percentage');
    });

    it('reverts if the maximum aum value is too high', async () => {
      await expect(
        deploy('ProtocolFeePercentagesProvider', {
          args: [vault.address, 0, FP_100_PCT.add(1)],
        })
      ).to.be.revertedWith('Invalid maximum fee percentage');
    });

    it('emits ProtocolFeeTypeRegistered events for custom types', async () => {
      // We deploy manually instead of using our helper to get the transaction receipt
      const artifact = getArtifact('ProtocolFeePercentagesProvider');
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, (await ethers.getSigners())[0]);
      const instance = await factory.deploy(vault.address, MAX_YIELD_VALUE, MAX_AUM_VALUE);
      const receipt = await instance.deployTransaction.wait();

      expectEvent.inIndirectReceipt(receipt, instance.interface, 'ProtocolFeeTypeRegistered', {
        feeType: FeeType.Yield,
        name: 'Yield',
        maximumPercentage: MAX_YIELD_VALUE,
      });

      expectEvent.inIndirectReceipt(receipt, instance.interface, 'ProtocolFeeTypeRegistered', {
        feeType: FeeType.AUM,
        name: 'Assets Under Management',
        maximumPercentage: MAX_AUM_VALUE,
      });
    });

    it('emits ProtocolFeePercentageChanged events for custom types', async () => {
      // We deploy manually instead of using our helper to get the transaction receipt
      const artifact = getArtifact('ProtocolFeePercentagesProvider');
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, (await ethers.getSigners())[0]);
      const instance = await factory.deploy(vault.address, MAX_YIELD_VALUE, MAX_AUM_VALUE);
      const receipt = await instance.deployTransaction.wait();

      expectEvent.inIndirectReceipt(receipt, instance.interface, 'ProtocolFeePercentageChanged', {
        feeType: FeeType.Yield,
        percentage: 0,
      });

      expectEvent.inIndirectReceipt(receipt, instance.interface, 'ProtocolFeePercentageChanged', {
        feeType: FeeType.AUM,
        percentage: 0,
      });
    });
  });

  context('with provider', () => {
    sharedBeforeEach('deploy', async () => {
      provider = await deploy('ProtocolFeePercentagesProvider', {
        args: [vault.address, MAX_YIELD_VALUE, MAX_AUM_VALUE],
      });
    });

    describe('fee type configuration', () => {
      function itReturnsNameAndMaximum(feeType: number, name: string, maximum: BigNumber, initialValue?: BigNumberish) {
        context(`fee type ${FeeType[feeType]}`, () => {
          it('returns the fee type as valid', async () => {
            expect(await provider.isValidFeeType(feeType)).to.equal(true);
          });

          it('returns the fee type name', async () => {
            expect(await provider.getFeeTypeName(feeType)).to.equal(name);
          });

          it('returns the fee type maximum value', async () => {
            expect(await provider.getFeeTypeMaximumPercentage(feeType)).to.equal(maximum);
          });

          if (initialValue !== undefined) {
            it('sets an initial value', async () => {
              expect(await provider.getFeeTypePercentage(feeType)).to.equal(initialValue);
            });
          }
        });
      }

      context('native fee types', () => {
        itReturnsNameAndMaximum(FeeType.Swap, 'Swap', MAX_SWAP_VALUE);

        itReturnsNameAndMaximum(FeeType.FlashLoan, 'Flash Loan', MAX_FLASH_LOAN_VALUE);
      });

      context('custom fee types', () => {
        itReturnsNameAndMaximum(FeeType.Yield, 'Yield', MAX_YIELD_VALUE, 0);

        itReturnsNameAndMaximum(FeeType.AUM, 'Assets Under Management', MAX_AUM_VALUE, 0);
      });

      context('invalid fee type', () => {
        it('isValidFeeType returns false', async () => {
          expect(await provider.isValidFeeType(INVALID_FEE_TYPE)).to.equal(false);
        });

        it('get name reverts', async () => {
          await expect(provider.getFeeTypeName(INVALID_FEE_TYPE)).to.be.revertedWith('Non-existent fee type');
        });

        it('get maximum reverts', async () => {
          await expect(provider.getFeeTypeMaximumPercentage(INVALID_FEE_TYPE)).to.be.revertedWith(
            'Non-existent fee type'
          );
        });
      });
    });

    describe('is valid fee percentage', () => {
      function itValidatesFeePercentagesCorrectly(feeType: number, maximum: BigNumber) {
        context(`fee type ${FeeType[feeType]}`, () => {
          it('returns true if the fee is below the maximum', async () => {
            expect(await provider.isValidFeeTypePercentage(feeType, 0)).to.equal(true);
            expect(await provider.isValidFeeTypePercentage(feeType, maximum.sub(1))).to.equal(true);
          });

          it('returns true if the fee equals the maximum', async () => {
            expect(await provider.isValidFeeTypePercentage(feeType, maximum)).to.equal(true);
          });

          it('returns false if the fee is above the maximum', async () => {
            expect(await provider.isValidFeeTypePercentage(feeType, maximum.add(1))).to.equal(false);
          });
        });
      }

      context('native fee types', () => {
        itValidatesFeePercentagesCorrectly(FeeType.Swap, MAX_SWAP_VALUE);

        itValidatesFeePercentagesCorrectly(FeeType.FlashLoan, MAX_FLASH_LOAN_VALUE);
      });

      context('custom fee types', () => {
        itValidatesFeePercentagesCorrectly(FeeType.Yield, MAX_YIELD_VALUE);

        itValidatesFeePercentagesCorrectly(FeeType.AUM, MAX_AUM_VALUE);
      });

      context('invalid fee type', () => {
        it('reverts', async () => {
          await expect(provider.isValidFeeTypePercentage(INVALID_FEE_TYPE, 0)).to.be.revertedWith(
            'Non-existent fee type'
          );
        });
      });
    });

    describe('set fee type value', () => {
      // Native and custom fee types are handled differently, as native fee types require an additional permission in
      // the ProtocolFeesCollector in order the be set

      context('native fee types', () => {
        function itSetsNativeFeeTypeValueCorrectly(feeType: number, maximum: BigNumber) {
          context(`fee type ${FeeType[feeType]}`, () => {
            context('when the caller is authorized', () => {
              sharedBeforeEach('grant permission to caller', async () => {
                await authorizer
                  .connect(admin)
                  .grantPermission(actionId(provider, 'setFeeTypePercentage'), authorized.address, provider.address);
              });

              context('when the provider is authorized', () => {
                sharedBeforeEach('grant permission to provider', async () => {
                  await authorizer
                    .connect(admin)
                    .grantPermission(
                      actionId(feesCollector, 'setSwapFeePercentage'),
                      provider.address,
                      feesCollector.address
                    );
                  await authorizer
                    .connect(admin)
                    .grantPermission(
                      actionId(feesCollector, 'setFlashLoanFeePercentage'),
                      provider.address,
                      feesCollector.address
                    );
                });

                function itSetsTheValueCorrectly(feeType: number, value: BigNumber) {
                  it('sets the value', async () => {
                    await provider.connect(authorized).setFeeTypePercentage(feeType, value);
                    expect(await provider.getFeeTypePercentage(feeType)).to.equal(value);
                  });

                  it('emits a ProtocolFeePercentageChanged event', async () => {
                    const receipt = await (
                      await provider.connect(authorized).setFeeTypePercentage(feeType, value)
                    ).wait();

                    expectEvent.inReceipt(receipt, 'ProtocolFeePercentageChanged', {
                      feeType,
                      percentage: value,
                    });
                  });
                }

                context('when the value is below the maximum', () => {
                  itSetsTheValueCorrectly(feeType, maximum.sub(1));
                });

                context('when the value is equal to the maximum', () => {
                  itSetsTheValueCorrectly(feeType, maximum);
                });

                context('when the value is above the maximum', () => {
                  it('reverts', async () => {
                    await expect(
                      provider.connect(authorized).setFeeTypePercentage(feeType, maximum.add(1))
                    ).to.be.revertedWith('Invalid fee percentage');
                  });
                });
              });

              context('when the provider is not authorized', () => {
                it('reverts', async () => {
                  // This revert happens in the ProtocolFeesCollector
                  await expect(provider.connect(authorized).setFeeTypePercentage(feeType, 0)).to.be.revertedWith(
                    'SENDER_NOT_ALLOWED'
                  );
                });
              });
            });

            context('when the caller is not authorized', () => {
              it('reverts', async () => {
                await expect(provider.setFeeTypePercentage(feeType, 0)).to.be.revertedWith('SENDER_NOT_ALLOWED');
              });
            });
          });
        }

        itSetsNativeFeeTypeValueCorrectly(FeeType.Swap, MAX_SWAP_VALUE);

        itSetsNativeFeeTypeValueCorrectly(FeeType.FlashLoan, MAX_FLASH_LOAN_VALUE);
      });

      context('custom fee types', () => {
        function itSetsCustomFeeTypeValueCorrectly(feeType: number, maximum: BigNumber) {
          context(`fee type ${FeeType[feeType]}`, () => {
            context('when the caller is authorized', () => {
              sharedBeforeEach('grant permission to caller', async () => {
                await authorizer
                  .connect(admin)
                  .grantPermission(actionId(provider, 'setFeeTypePercentage'), authorized.address, provider.address);
              });

              function itSetsTheValueCorrectly(feeType: number, value: BigNumber) {
                it('sets the value', async () => {
                  await provider.connect(authorized).setFeeTypePercentage(feeType, value);
                  expect(await provider.getFeeTypePercentage(feeType)).to.equal(value);
                });

                it('emits a ProtocolFeePercentageChanged event', async () => {
                  const receipt = await (
                    await provider.connect(authorized).setFeeTypePercentage(feeType, value)
                  ).wait();

                  expectEvent.inReceipt(receipt, 'ProtocolFeePercentageChanged', {
                    feeType,
                    percentage: value,
                  });
                });
              }

              context('when the value is below the maximum', () => {
                itSetsTheValueCorrectly(feeType, maximum.sub(1));
              });

              context('when the value is equal to the maximum', () => {
                itSetsTheValueCorrectly(feeType, maximum);
              });

              context('when the value is above the maximum', () => {
                it('reverts', async () => {
                  await expect(
                    provider.connect(authorized).setFeeTypePercentage(feeType, maximum.add(1))
                  ).to.be.revertedWith('Invalid fee percentage');
                });
              });
            });

            context('when the caller is not authorized', () => {
              it('reverts', async () => {
                await expect(provider.setFeeTypePercentage(feeType, 0)).to.be.revertedWith('SENDER_NOT_ALLOWED');
              });
            });
          });
        }

        itSetsCustomFeeTypeValueCorrectly(FeeType.Yield, MAX_YIELD_VALUE);

        itSetsCustomFeeTypeValueCorrectly(FeeType.AUM, MAX_AUM_VALUE);
      });

      context('invalid fee type', () => {
        it('reverts', async () => {
          await expect(provider.setFeeTypePercentage(INVALID_FEE_TYPE, 0)).to.be.revertedWith('Non-existent fee type');
        });
      });
    });

    describe('native fee type out of band change', () => {
      sharedBeforeEach('grant permission', async () => {
        await authorizer
          .connect(admin)
          .grantPermission(actionId(feesCollector, 'setSwapFeePercentage'), other.address, feesCollector.address);
        await authorizer
          .connect(admin)
          .grantPermission(actionId(feesCollector, 'setFlashLoanFeePercentage'), other.address, feesCollector.address);
      });

      describe('swap fee', () => {
        it('the provider tracks value changes', async () => {
          await feesCollector.connect(other).setSwapFeePercentage(fp(0.13));
          expect(await provider.getFeeTypePercentage(FeeType.Swap)).to.equal(fp(0.13));
        });
      });

      describe('flash loan fee', () => {
        it('the provider tracks value changes', async () => {
          await feesCollector.connect(other).setFlashLoanFeePercentage(fp(0.0013));
          expect(await provider.getFeeTypePercentage(FeeType.FlashLoan)).to.equal(fp(0.0013));
        });
      });
    });

    describe('register fee type', () => {
      const NEW_FEE_TYPE = 42;
      const NEW_FEE_TYPE_MAXIMUM = fp(0.6);

      context('when the caller is authorized', () => {
        sharedBeforeEach('grant permission', async () => {
          await authorizer
            .connect(admin)
            .grantPermission(actionId(provider, 'registerFeeType'), authorized.address, provider.address);
        });

        context('when the fee type is already in use', () => {
          it('reverts', async () => {
            await expect(provider.connect(authorized).registerFeeType(FeeType.FlashLoan, '', 0, 0)).to.be.revertedWith(
              'Fee type already registered'
            );
          });
        });

        context('when the maximum value is 0%', () => {
          it('reverts', async () => {
            await expect(provider.connect(authorized).registerFeeType(NEW_FEE_TYPE, '', 0, 0)).to.be.revertedWith(
              'Invalid maximum fee percentage'
            );
          });
        });

        context('when the maximum value is above 100%', () => {
          it('reverts', async () => {
            await expect(
              provider.connect(authorized).registerFeeType(NEW_FEE_TYPE, '', FP_100_PCT.add(1), 0)
            ).to.be.revertedWith('Invalid maximum fee percentage');
          });
        });

        context('when the initial value is above the maximum value', () => {
          it('reverts', async () => {
            await expect(
              provider
                .connect(authorized)
                .registerFeeType(NEW_FEE_TYPE, '', NEW_FEE_TYPE_MAXIMUM, NEW_FEE_TYPE_MAXIMUM.add(1))
            ).to.be.revertedWith('Invalid initial percentage');
          });
        });

        context('when the new fee type data is valid', () => {
          const initial = NEW_FEE_TYPE_MAXIMUM.div(3);

          it('returns registered data', async () => {
            await provider
              .connect(authorized)
              .registerFeeType(NEW_FEE_TYPE, 'New Fee Type', NEW_FEE_TYPE_MAXIMUM, initial);

            expect(await provider.getFeeTypeName(NEW_FEE_TYPE)).to.equal('New Fee Type');
            expect(await provider.getFeeTypeMaximumPercentage(NEW_FEE_TYPE)).to.equal(NEW_FEE_TYPE_MAXIMUM);
            expect(await provider.getFeeTypePercentage(NEW_FEE_TYPE)).to.equal(initial);
          });

          it('marks the fee type as valid', async () => {
            await provider
              .connect(authorized)
              .registerFeeType(NEW_FEE_TYPE, 'New Fee Type', NEW_FEE_TYPE_MAXIMUM, initial);

            expect(await provider.isValidFeeType(NEW_FEE_TYPE)).to.equal(true);
          });

          it('emits a ProtocolFeeTypeRegistered event', async () => {
            const receipt = await (
              await provider
                .connect(authorized)
                .registerFeeType(NEW_FEE_TYPE, 'New Fee Type', NEW_FEE_TYPE_MAXIMUM, initial)
            ).wait();

            expectEvent.inReceipt(receipt, 'ProtocolFeeTypeRegistered', {
              feeType: NEW_FEE_TYPE,
              name: 'New Fee Type',
              maximumPercentage: NEW_FEE_TYPE_MAXIMUM,
            });
          });

          it('emits a ProtocolFeePercentageChanged event', async () => {
            const receipt = await (
              await provider
                .connect(authorized)
                .registerFeeType(NEW_FEE_TYPE, 'New Fee Type', NEW_FEE_TYPE_MAXIMUM, initial)
            ).wait();

            expectEvent.inReceipt(receipt, 'ProtocolFeePercentageChanged', {
              feeType: NEW_FEE_TYPE,
              percentage: initial,
            });
          });

          it('reverts on register attempt', async () => {
            const register = () =>
              provider.connect(authorized).registerFeeType(NEW_FEE_TYPE, 'New Fee Type', NEW_FEE_TYPE_MAXIMUM, initial);

            await register();
            await expect(register()).to.be.revertedWith('Fee type already registered');
          });

          it('can change value after registration', async () => {
            await provider
              .connect(authorized)
              .registerFeeType(NEW_FEE_TYPE, 'New Fee Type', NEW_FEE_TYPE_MAXIMUM, initial);

            await authorizer
              .connect(admin)
              .grantPermission(actionId(provider, 'setFeeTypePercentage'), authorized.address, provider.address);

            await provider.connect(authorized).setFeeTypePercentage(NEW_FEE_TYPE, fp(0.042));
            expect(await provider.getFeeTypePercentage(NEW_FEE_TYPE)).to.equal(fp(0.042));
          });
        });
      });

      context('when the caller is not authorized', () => {
        it('reverts', async () => {
          await expect(provider.registerFeeType(NEW_FEE_TYPE, '', 0, 0)).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });
  });
});
