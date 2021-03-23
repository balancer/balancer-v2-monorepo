import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';

import { deploy } from '../../../lib/helpers/deploy';
import { BigNumberish, bn, fp, min } from '../../../lib/helpers/numbers';
import { MAX_UINT112, MAX_UINT32 } from '../../../lib/helpers/constants';

describe('Vault - internal balance allocation', () => {
  let library: Contract;

  before(async () => {
    library = await deploy('InternalBalanceAllocationMock');
  });

  const toBalance = async (
    actual: BigNumberish,
    exempt: BigNumberish,
    blockNumber: BigNumberish
  ): Promise<BigNumber> => {
    actual = bn(actual);
    exempt = bn(exempt);
    blockNumber = bn(blockNumber);
    return library.toInternalBalance(actual, exempt, blockNumber);
  };

  describe('packing', () => {
    async function testBalanceAllocation(actual: BigNumberish, exempt: BigNumberish, blockNumber: BigNumberish) {
      const balance = await toBalance(actual, exempt, blockNumber);

      expect(await library.actual(balance)).to.equal(actual);
      expect(await library.exempt(balance)).to.equal(exempt);
      expect(await library.blockNumber(balance)).to.equal(blockNumber);
    }

    it('stores zero values', async () => {
      await testBalanceAllocation(0, 0, 0);
    });

    it('stores partial zero values', async () => {
      await testBalanceAllocation(42, 0, 0);
      await testBalanceAllocation(0, 23, 0);
      await testBalanceAllocation(0, 0, 10);

      await testBalanceAllocation(MAX_UINT112, 0, 0);
      await testBalanceAllocation(0, MAX_UINT112, 0);
      await testBalanceAllocation(0, 0, MAX_UINT32);
    });

    it('stores non-zero values', async () => {
      await testBalanceAllocation(42, 23, 50);
      await testBalanceAllocation(MAX_UINT112.div(3), MAX_UINT112.div(3), MAX_UINT32.div(3));
    });

    it('stores extreme actual balances', async () => {
      await testBalanceAllocation(MAX_UINT112.sub(23), 23, 10000);
    });

    it('stores extreme exempts', async () => {
      await testBalanceAllocation(42, MAX_UINT112.sub(42), 10000);
    });

    it('stores extreme values', async () => {
      await testBalanceAllocation(MAX_UINT112.div(2), MAX_UINT112.div(2).add(1), 10000);
    });

    it('stores extreme block number', async () => {
      await testBalanceAllocation(42, 10, MAX_UINT32);
    });

    it('reverts on overflow', async () => {
      await expect(testBalanceAllocation(MAX_UINT112.add(1), 1, 0)).to.be.revertedWith('INTERNAL_BALANCE_OVERFLOW');
      await expect(testBalanceAllocation(1, MAX_UINT112.add(1), 0)).to.be.revertedWith('INTERNAL_BALANCE_OVERFLOW');
    });
  });

  describe('increase', () => {
    const increasingAmount = fp(1);
    let currentBlockNumber: number;

    sharedBeforeEach('compute current block number', async () => {
      currentBlockNumber = await ethers.provider.getBlockNumber();
    });

    context('when tracking exempts', () => {
      const track = true;

      context('when there was a previous actual value', () => {
        context('when there is room for a bigger actual value', () => {
          const previousActual = fp(10);

          context('when there was a previous exempt', () => {
            const previousExempt = fp(1);
            let previousBlockNumber: number;

            context('when the block number matches the one for previous exempt', () => {
              sharedBeforeEach('compute previous block number', async () => {
                previousBlockNumber = currentBlockNumber;
              });

              it('adds both exempts', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                const newBalance = await library.increase(previousBalance, increasingAmount, track);
                expect(await library.actual(newBalance)).to.equal(previousActual.add(increasingAmount));
                expect(await library.exempt(newBalance)).to.equal(previousExempt.add(increasingAmount));
                expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);
              });
            });

            context('when the block number does not match the one for previous exempt', () => {
              sharedBeforeEach('compute previous block number', async () => {
                previousBlockNumber = currentBlockNumber - 1;
              });

              it('overwrites the previous exempt', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                const newBalance = await library.increase(previousBalance, increasingAmount, track);
                expect(await library.actual(newBalance)).to.equal(previousActual.add(increasingAmount));
                expect(await library.exempt(newBalance)).to.equal(increasingAmount);
                expect(await library.blockNumber(newBalance)).to.equal(currentBlockNumber);
              });
            });
          });

          context('when there was no previous exempt', () => {
            const previousExempt = 0;
            const previousBlockNumber = 0;

            it('stores the exempt', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              const newBalance = await library.increase(previousBalance, increasingAmount, track);
              expect(await library.actual(newBalance)).to.equal(previousActual.add(increasingAmount));
              expect(await library.exempt(newBalance)).to.equal(increasingAmount);
              expect(await library.blockNumber(newBalance)).to.equal(currentBlockNumber);
            });
          });
        });

        context('when the actual value cannot be increased', () => {
          const previousActual = MAX_UINT112;

          context('when there was a previous exempt', () => {
            const previousExempt = fp(1);
            let previousBlockNumber: number;

            context('when the block number matches the one for previous exempt', () => {
              sharedBeforeEach('compute previous block number', async () => {
                previousBlockNumber = currentBlockNumber;
              });

              it('reverts', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                await expect(library.increase(previousBalance, increasingAmount, track)).to.be.revertedWith(
                  'INTERNAL_BALANCE_OVERFLOW'
                );
              });
            });

            context('when the block number does not match the one for previous exempt', () => {
              sharedBeforeEach('compute previous block number', async () => {
                previousBlockNumber = currentBlockNumber - 1;
              });

              it('reverts', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                await expect(library.increase(previousBalance, increasingAmount, track)).to.be.revertedWith(
                  'INTERNAL_BALANCE_OVERFLOW'
                );
              });
            });
          });

          context('when there was no previous exempt', () => {
            const previousExempt = 0;
            const previousBlockNumber = 0;

            it('stores the exempt', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              await expect(library.increase(previousBalance, increasingAmount, track)).to.be.revertedWith(
                'INTERNAL_BALANCE_OVERFLOW'
              );
            });
          });
        });
      });

      context('when there was no previous actual value', () => {
        const previousActual = 0;

        context('when there was a previous exempt', () => {
          const previousExempt = fp(1);
          let previousBlockNumber: number;

          context('when the block number matches the one for previous exempt', () => {
            sharedBeforeEach('compute previous block number', async () => {
              previousBlockNumber = currentBlockNumber;
            });

            it('adds both exempts', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              const newBalance = await library.increase(previousBalance, increasingAmount, track);
              expect(await library.actual(newBalance)).to.equal(increasingAmount);
              expect(await library.exempt(newBalance)).to.equal(previousExempt.add(increasingAmount));
              expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);
            });
          });

          context('when the block number does not match the one for previous exempt', () => {
            sharedBeforeEach('compute previous block number', async () => {
              previousBlockNumber = currentBlockNumber - 1;
            });

            it('overwrites the previous exempt', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              const newBalance = await library.increase(previousBalance, increasingAmount, track);
              expect(await library.actual(newBalance)).to.equal(increasingAmount);
              expect(await library.exempt(newBalance)).to.equal(increasingAmount);
              expect(await library.blockNumber(newBalance)).to.equal(currentBlockNumber);
            });
          });
        });

        context('when there was no previous exempt', () => {
          const previousExempt = 0;
          const previousBlockNumber = 0;

          it('stores the exempt', async () => {
            const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

            const newBalance = await library.increase(previousBalance, increasingAmount, track);
            expect(await library.actual(newBalance)).to.equal(increasingAmount);
            expect(await library.exempt(newBalance)).to.equal(increasingAmount);
            expect(await library.blockNumber(newBalance)).to.equal(currentBlockNumber);
          });
        });
      });
    });

    context('when not tracking exempts', () => {
      const track = false;

      context('when there was a previous actual value', () => {
        context('when there is room for a bigger actual value', () => {
          const previousActual = fp(10);

          context('when there was a previous exempt', () => {
            const previousExempt = fp(1);
            let previousBlockNumber: number;

            context('when the block number matches the one for previous exempt', () => {
              sharedBeforeEach('compute previous block number', async () => {
                previousBlockNumber = currentBlockNumber;
              });

              it('does not affect the previous exempt', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                const newBalance = await library.increase(previousBalance, increasingAmount, track);
                expect(await library.actual(newBalance)).to.equal(previousActual.add(increasingAmount));
                expect(await library.exempt(newBalance)).to.equal(previousExempt);
                expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);
              });
            });

            context('when the block number does not match the one for previous exempt', () => {
              sharedBeforeEach('compute previous block number', async () => {
                previousBlockNumber = currentBlockNumber - 1;
              });

              it('does not affect the previous exempt', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                const newBalance = await library.increase(previousBalance, increasingAmount, track);
                expect(await library.actual(newBalance)).to.equal(previousActual.add(increasingAmount));
                expect(await library.exempt(newBalance)).to.equal(previousExempt);
                expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);
              });
            });
          });

          context('when there was no previous exempt', () => {
            const previousExempt = 0;
            const previousBlockNumber = 0;

            it('does not affect the previous exempt', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              const newBalance = await library.increase(previousBalance, increasingAmount, track);
              expect(await library.actual(newBalance)).to.equal(previousActual.add(increasingAmount));
              expect(await library.exempt(newBalance)).to.equal(previousExempt);
              expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);
            });
          });
        });

        context('when the actual value cannot be increased', () => {
          const previousActual = MAX_UINT112;

          context('when there was a previous exempt', () => {
            const previousExempt = fp(1);
            let previousBlockNumber: number;

            context('when the block number matches the one for previous exempt', () => {
              sharedBeforeEach('compute previous block number', async () => {
                previousBlockNumber = currentBlockNumber;
              });

              it('reverts', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                await expect(library.increase(previousBalance, increasingAmount, track)).to.be.revertedWith(
                  'INTERNAL_BALANCE_OVERFLOW'
                );
              });
            });

            context('when the block number does not match the one for previous exempt', () => {
              sharedBeforeEach('compute previous block number', async () => {
                previousBlockNumber = currentBlockNumber - 1;
              });

              it('reverts', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                await expect(library.increase(previousBalance, increasingAmount, track)).to.be.revertedWith(
                  'INTERNAL_BALANCE_OVERFLOW'
                );
              });
            });
          });

          context('when there was no previous exempt', () => {
            const previousExempt = 0;
            const previousBlockNumber = 0;

            it('stores the exempt', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              await expect(library.increase(previousBalance, increasingAmount, track)).to.be.revertedWith(
                'INTERNAL_BALANCE_OVERFLOW'
              );
            });
          });
        });
      });

      context('when there was no previous actual value', () => {
        const previousActual = 0;

        context('when there was a previous exempt', () => {
          const previousExempt = fp(1);
          let previousBlockNumber: number;

          context('when the block number matches the one for previous exempt', () => {
            sharedBeforeEach('compute previous block number', async () => {
              previousBlockNumber = currentBlockNumber;
            });

            it('does not affect the previous exempt', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              const newBalance = await library.increase(previousBalance, increasingAmount, track);
              expect(await library.actual(newBalance)).to.equal(increasingAmount);
              expect(await library.exempt(newBalance)).to.equal(previousExempt);
              expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);
            });
          });

          context('when the block number does not match the one for previous exempt', () => {
            sharedBeforeEach('compute previous block number', async () => {
              previousBlockNumber = currentBlockNumber - 1;
            });

            it('does not affect the previous exempt', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              const newBalance = await library.increase(previousBalance, increasingAmount, track);
              expect(await library.actual(newBalance)).to.equal(increasingAmount);
              expect(await library.exempt(newBalance)).to.equal(previousExempt);
              expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);
            });
          });
        });

        context('when there was no previous exempt', () => {
          const previousExempt = 0;
          const previousBlockNumber = 0;

          it('does not affect the previous exempt', async () => {
            const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

            const newBalance = await library.increase(previousBalance, increasingAmount, track);
            expect(await library.actual(newBalance)).to.equal(increasingAmount);
            expect(await library.exempt(newBalance)).to.equal(previousExempt);
            expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);
          });
        });
      });
    });
  });

  describe('decrease', () => {
    const decreasingAmount = fp(10);
    let currentBlockNumber: number;

    sharedBeforeEach('compute current block number', async () => {
      currentBlockNumber = await ethers.provider.getBlockNumber();
    });

    const itDecreasesTheBalanceProperlyWhenNoPreviousActualValue = (useExempt: boolean) => {
      const previousActual = 0;

      context('when capped', () => {
        const capped = true;

        context('when there was a previous exempt', () => {
          const previousExempt = fp(1);
          let previousBlockNumber: number;

          context('when the block number matches the one for previous exempt', () => {
            sharedBeforeEach('compute previous block number', async () => {
              previousBlockNumber = currentBlockNumber;
            });

            it('does not affect the exempt and does not charge any taxes', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              const [newBalance, taxableAmount, decreased] = await library.decrease(
                previousBalance,
                decreasingAmount,
                capped,
                useExempt
              );
              expect(await library.actual(newBalance)).to.equal(0);
              expect(await library.exempt(newBalance)).to.equal(previousExempt);
              expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);

              expect(taxableAmount).to.equal(0);
              expect(decreased).to.equal(0);
            });
          });

          context('when the block number does not match the one for previous exempt', () => {
            sharedBeforeEach('compute previous block number', async () => {
              previousBlockNumber = currentBlockNumber - 1;
            });

            it('sets the exempt to zero and does not charge any taxes', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              const [newBalance, taxableAmount, decreased] = await library.decrease(
                previousBalance,
                decreasingAmount,
                capped,
                useExempt
              );
              expect(await library.actual(newBalance)).to.equal(0);
              expect(await library.exempt(newBalance)).to.equal(0);
              expect(await library.blockNumber(newBalance)).to.equal(0);

              expect(taxableAmount).to.equal(0);
              expect(decreased).to.equal(0);
            });
          });
        });

        context('when there was no previous exempt', () => {
          const previousExempt = 0;
          const previousBlockNumber = 0;

          it('does not charge any taxesstores the exempt', async () => {
            const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

            const [newBalance, taxableAmount, decreased] = await library.decrease(
              previousBalance,
              decreasingAmount,
              capped,
              useExempt
            );
            expect(await library.actual(newBalance)).to.equal(0);
            expect(await library.exempt(newBalance)).to.equal(0);
            expect(await library.blockNumber(newBalance)).to.equal(0);

            expect(taxableAmount).to.equal(0);
            expect(decreased).to.equal(0);
          });
        });
      });

      context('when not capped', () => {
        const capped = false;

        context('when there was a previous exempt', () => {
          const previousExempt = fp(1);
          let previousBlockNumber: number;

          context('when the block number matches the one for previous exempt', () => {
            sharedBeforeEach('compute previous block number', async () => {
              previousBlockNumber = currentBlockNumber;
            });

            it('reverts', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              await expect(library.decrease(previousBalance, decreasingAmount, capped, useExempt)).to.be.revertedWith(
                'INSUFFICIENT_INTERNAL_BALANCE'
              );
            });
          });

          context('when the block number does not match the one for previous exempt', () => {
            sharedBeforeEach('compute previous block number', async () => {
              previousBlockNumber = currentBlockNumber - 1;
            });

            it('reverts', async () => {
              const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

              await expect(library.decrease(previousBalance, decreasingAmount, capped, useExempt)).to.be.revertedWith(
                'INSUFFICIENT_INTERNAL_BALANCE'
              );
            });
          });
        });

        context('when there was no previous exempt', () => {
          const previousExempt = 0;
          const previousBlockNumber = 0;

          it('reverts', async () => {
            const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

            await expect(library.decrease(previousBalance, decreasingAmount, capped, useExempt)).to.be.revertedWith(
              'INSUFFICIENT_INTERNAL_BALANCE'
            );
          });
        });
      });
    };

    context('when using exempts', () => {
      const useExempt = true;

      context('when there was a previous actual value', () => {
        context('when there is room for a smaller actual value', () => {
          const previousActual = decreasingAmount.add(fp(1));

          const itDecreasesTheBalanceIgnoringCappedOption = (capped: boolean) => {
            context('when there was a previous exempt', () => {
              let previousBlockNumber: number;

              context('when the previous exempt was smaller than the decreasing amount', () => {
                const previousExempt = decreasingAmount.sub(fp(1));

                context('when the block number matches the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber;
                  });

                  it('sets the previous exempt to zero and charges fee based on the exceeding decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);

                    expect(taxableAmount).to.equal(decreasingAmount.sub(previousExempt));
                    expect(decreased).to.equal(decreasingAmount);
                  });
                });

                context('when the block number does not match the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber - 1;
                  });

                  it('sets the previous exempt to zero and taxes the entire decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(0);

                    expect(taxableAmount).to.equal(decreasingAmount);
                    expect(decreased).to.equal(decreasingAmount);
                  });
                });
              });

              context('when the previous exempt was bigger than the decreasing amount', () => {
                const previousExempt = decreasingAmount.add(fp(1));

                context('when the block number matches the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber;
                  });

                  it('reduces the previous exempt and does not charge any taxes', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                    expect(await library.exempt(newBalance)).to.equal(previousExempt.sub(decreasingAmount));
                    expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);

                    expect(taxableAmount).to.equal(0);
                    expect(decreased).to.equal(decreasingAmount);
                  });
                });

                context('when the block number does not match the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber - 1;
                  });

                  it('sets the previous exempt to zero and taxes the entire decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(0);

                    expect(taxableAmount).to.equal(decreasingAmount);
                    expect(decreased).to.equal(decreasingAmount);
                  });
                });
              });
            });

            context('when there was no previous exempt', () => {
              const previousExempt = 0;
              const previousBlockNumber = 0;

              it('keeps the zero exempt and taxes the entire decreased amount', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                const [newBalance, taxableAmount, decreased] = await library.decrease(
                  previousBalance,
                  decreasingAmount,
                  capped,
                  useExempt
                );
                expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                expect(await library.exempt(newBalance)).to.equal(0);
                expect(await library.blockNumber(newBalance)).to.equal(0);

                expect(taxableAmount).to.equal(decreasingAmount);
                expect(decreased).to.equal(decreasingAmount);
              });
            });
          };

          context('when capped', () => {
            itDecreasesTheBalanceIgnoringCappedOption(true);
          });

          context('when not capped', () => {
            itDecreasesTheBalanceIgnoringCappedOption(false);
          });
        });

        context('when the actual value cannot be decreased', () => {
          const previousActual = decreasingAmount.sub(fp(1));

          context('when capped', () => {
            const capped = true;

            context('when there was a previous exempt', () => {
              let previousBlockNumber: number;

              context('when the previous exempt was smaller than the decreasing amount', () => {
                const previousExempt = decreasingAmount.sub(fp(1));

                context('when the block number matches the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber;
                  });

                  it('sets the previous exempt to zero and charges fee based on the maximum exceeding decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(0);
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);

                    expect(taxableAmount).to.equal(min(previousActual, decreasingAmount).sub(previousExempt));
                    expect(decreased).to.equal(min(previousActual, decreasingAmount));
                  });
                });

                context('when the block number does not match the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber - 1;
                  });

                  it('sets the previous exempt to zero and taxes the maximum decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(0);
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(0);

                    expect(taxableAmount).to.equal(min(previousActual, decreasingAmount));
                    expect(decreased).to.equal(min(previousActual, decreasingAmount));
                  });
                });
              });

              context('when the previous exempt was bigger than the decreasing amount', () => {
                const previousExempt = decreasingAmount.add(fp(1));

                context('when the block number matches the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber;
                  });

                  it('reduces the previous exempt and does not charge any taxes', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);
                    const expectedDecreasedAmount = min(previousActual, decreasingAmount);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(0);
                    expect(await library.exempt(newBalance)).to.equal(previousExempt.sub(expectedDecreasedAmount));
                    expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);

                    expect(taxableAmount).to.equal(0);
                    expect(decreased).to.equal(expectedDecreasedAmount);
                  });
                });

                context('when the block number does not match the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber - 1;
                  });

                  it('sets the previous exempt to zero and does not charge any taxes', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(0);
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(0);

                    expect(taxableAmount).to.equal(min(previousActual, decreasingAmount));
                    expect(decreased).to.equal(min(previousActual, decreasingAmount));
                  });
                });
              });
            });

            context('when there was no previous exempt', () => {
              const previousExempt = 0;
              const previousBlockNumber = 0;

              it('keeps the zero exempt and charges the entire decreased amount', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                const [newBalance, taxableAmount, decreased] = await library.decrease(
                  previousBalance,
                  decreasingAmount,
                  capped,
                  useExempt
                );
                expect(await library.actual(newBalance)).to.equal(0);
                expect(await library.exempt(newBalance)).to.equal(0);
                expect(await library.blockNumber(newBalance)).to.equal(0);

                expect(taxableAmount).to.equal(min(previousActual, decreasingAmount));
                expect(decreased).to.equal(min(previousActual, decreasingAmount));
              });
            });
          });

          context('when not capped', () => {
            const capped = false;

            context('when there was a previous exempt', () => {
              const previousExempt = fp(1);
              let previousBlockNumber: number;

              context('when the block number matches the one for previous exempt', () => {
                sharedBeforeEach('compute previous block number', async () => {
                  previousBlockNumber = currentBlockNumber;
                });

                it('reverts', async () => {
                  const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                  await expect(
                    library.decrease(previousBalance, decreasingAmount, capped, useExempt)
                  ).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
                });
              });

              context('when the block number does not match the one for previous exempt', () => {
                sharedBeforeEach('compute previous block number', async () => {
                  previousBlockNumber = currentBlockNumber - 1;
                });

                it('reverts', async () => {
                  const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                  await expect(
                    library.decrease(previousBalance, decreasingAmount, capped, useExempt)
                  ).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
                });
              });
            });

            context('when there was no previous exempt', () => {
              const previousExempt = 0;
              const previousBlockNumber = 0;

              it('reverts', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                await expect(library.decrease(previousBalance, decreasingAmount, capped, useExempt)).to.be.revertedWith(
                  'INSUFFICIENT_INTERNAL_BALANCE'
                );
              });
            });
          });
        });
      });

      context('when there was no previous actual value', () => {
        itDecreasesTheBalanceProperlyWhenNoPreviousActualValue(useExempt);
      });
    });

    context('when not using exempts', () => {
      const useExempt = false;

      context('when there was a previous actual value', () => {
        context('when there is room for a smaller actual value', () => {
          const previousActual = decreasingAmount.add(fp(1));

          const itDecreasesTheBalanceIgnoringCappedOption = (capped: boolean) => {
            context('when there was a previous exempt', () => {
              let previousBlockNumber: number;

              context('when the previous exempt was smaller than the decreasing amount', () => {
                const previousExempt = decreasingAmount.sub(fp(1));

                context('when the block number matches the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber;
                  });

                  it('does not affect the previous exempt and charges the entire decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                    expect(await library.exempt(newBalance)).to.equal(previousExempt);
                    expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);

                    expect(taxableAmount).to.equal(decreasingAmount);
                    expect(decreased).to.equal(decreasingAmount);
                  });
                });

                context('when the block number does not match the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber - 1;
                  });

                  it('sets the previous exempt to zero and taxes the entire decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(0);

                    expect(taxableAmount).to.equal(decreasingAmount);
                    expect(decreased).to.equal(decreasingAmount);
                  });
                });
              });

              context('when the previous exempt was bigger than the decreasing amount', () => {
                const previousExempt = decreasingAmount.add(fp(1));

                context('when the block number matches the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber;
                  });

                  it('does not affect the previous exempt and charges the entire decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                    expect(await library.exempt(newBalance)).to.equal(previousExempt);
                    expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);

                    expect(taxableAmount).to.equal(decreasingAmount);
                    expect(decreased).to.equal(decreasingAmount);
                  });
                });

                context('when the block number does not match the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber - 1;
                  });

                  it('sets the previous exempt to zero and taxes the entire decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(0);

                    expect(taxableAmount).to.equal(decreasingAmount);
                    expect(decreased).to.equal(decreasingAmount);
                  });
                });
              });
            });

            context('when there was no previous exempt', () => {
              const previousExempt = 0;
              const previousBlockNumber = 0;

              it('keeps the zero exempt and taxes the entire decreased amount', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                const [newBalance, taxableAmount, decreased] = await library.decrease(
                  previousBalance,
                  decreasingAmount,
                  capped,
                  useExempt
                );
                expect(await library.actual(newBalance)).to.equal(previousActual.sub(decreasingAmount));
                expect(await library.exempt(newBalance)).to.equal(0);
                expect(await library.blockNumber(newBalance)).to.equal(0);

                expect(taxableAmount).to.equal(decreasingAmount);
                expect(decreased).to.equal(decreasingAmount);
              });
            });
          };

          context('when capped', () => {
            itDecreasesTheBalanceIgnoringCappedOption(true);
          });

          context('when not capped', () => {
            itDecreasesTheBalanceIgnoringCappedOption(false);
          });
        });

        context('when the actual value cannot be decreased', () => {
          const previousActual = decreasingAmount.sub(fp(1));

          context('when capped', () => {
            const capped = true;

            context('when there was a previous exempt', () => {
              let previousBlockNumber: number;

              const itDecreasesTheBalanceIgnoringPreviousExempts = (previousExempt: BigNumber) => {
                context('when the block number matches the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber;
                  });

                  it('does not affect the previous exempt and charges fee based on the maximum exceeding decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(0);
                    expect(await library.exempt(newBalance)).to.equal(previousExempt);
                    expect(await library.blockNumber(newBalance)).to.equal(previousBlockNumber);

                    expect(taxableAmount).to.equal(min(previousActual, decreasingAmount));
                    expect(decreased).to.equal(min(previousActual, decreasingAmount));
                  });
                });

                context('when the block number does not match the one for previous exempt', () => {
                  sharedBeforeEach('compute previous block number', async () => {
                    previousBlockNumber = currentBlockNumber - 1;
                  });

                  it('sets the previous exempt to zero and taxes the maximum decreased amount', async () => {
                    const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                    const [newBalance, taxableAmount, decreased] = await library.decrease(
                      previousBalance,
                      decreasingAmount,
                      capped,
                      useExempt
                    );
                    expect(await library.actual(newBalance)).to.equal(0);
                    expect(await library.exempt(newBalance)).to.equal(0);
                    expect(await library.blockNumber(newBalance)).to.equal(0);

                    expect(taxableAmount).to.equal(min(previousActual, decreasingAmount));
                    expect(decreased).to.equal(min(previousActual, decreasingAmount));
                  });
                });
              };

              context('when the previous exempt was smaller than the decreasing amount', () => {
                const previousExempt = decreasingAmount.sub(fp(1));

                itDecreasesTheBalanceIgnoringPreviousExempts(previousExempt);
              });

              context('when the previous exempt was bigger than the decreasing amount', () => {
                const previousExempt = decreasingAmount.add(fp(1));

                itDecreasesTheBalanceIgnoringPreviousExempts(previousExempt);
              });
            });

            context('when there was no previous exempt', () => {
              const previousExempt = 0;
              const previousBlockNumber = 0;

              it('keeps the zero exempt and charges the entire decreased amount', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                const [newBalance, taxableAmount, decreased] = await library.decrease(
                  previousBalance,
                  decreasingAmount,
                  capped,
                  useExempt
                );
                expect(await library.actual(newBalance)).to.equal(0);
                expect(await library.exempt(newBalance)).to.equal(0);
                expect(await library.blockNumber(newBalance)).to.equal(0);

                expect(taxableAmount).to.equal(min(previousActual, decreasingAmount));
                expect(decreased).to.equal(min(previousActual, decreasingAmount));
              });
            });
          });

          context('when not capped', () => {
            const capped = false;

            context('when there was a previous exempt', () => {
              const previousExempt = fp(1);
              let previousBlockNumber: number;

              context('when the block number matches the one for previous exempt', () => {
                sharedBeforeEach('compute previous block number', async () => {
                  previousBlockNumber = currentBlockNumber;
                });

                it('reverts', async () => {
                  const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                  await expect(
                    library.decrease(previousBalance, decreasingAmount, capped, useExempt)
                  ).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
                });
              });

              context('when the block number does not match the one for previous exempt', () => {
                sharedBeforeEach('compute previous block number', async () => {
                  previousBlockNumber = currentBlockNumber - 1;
                });

                it('reverts', async () => {
                  const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                  await expect(
                    library.decrease(previousBalance, decreasingAmount, capped, useExempt)
                  ).to.be.revertedWith('INSUFFICIENT_INTERNAL_BALANCE');
                });
              });
            });

            context('when there was no previous exempt', () => {
              const previousExempt = 0;
              const previousBlockNumber = 0;

              it('reverts', async () => {
                const previousBalance = await toBalance(previousActual, previousExempt, previousBlockNumber);

                await expect(library.decrease(previousBalance, decreasingAmount, capped, useExempt)).to.be.revertedWith(
                  'INSUFFICIENT_INTERNAL_BALANCE'
                );
              });
            });
          });
        });
      });

      context('when there was no previous actual value', () => {
        itDecreasesTheBalanceProperlyWhenNoPreviousActualValue(useExempt);
      });
    });
  });
});
