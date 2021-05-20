import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT112, MAX_UINT32 } from '@balancer-labs/v2-helpers/src/constants';
import { lastBlockNumber } from '@balancer-labs/v2-helpers/src/time';

describe('balance allocation', () => {
  let library: Contract;
  const BLOCK_NUMBER = 10;

  before(async () => {
    library = await deploy('BalanceAllocationMock');
  });

  describe('cash, managed & last change block', () => {
    async function testBalanceAllocation(cash: BigNumberish, managed: BigNumberish, lastChangeBlock: BigNumberish) {
      cash = bn(cash);
      managed = bn(managed);
      lastChangeBlock = bn(lastChangeBlock);

      const balance = await library.toBalance(cash, managed, lastChangeBlock);

      expect(await library.cash(balance)).to.equal(cash);
      expect(await library.managed(balance)).to.equal(managed);
      expect(await library.lastChangeBlock(balance)).to.equal(lastChangeBlock);
      expect(await library.total(balance)).to.equal(cash.add(managed));
    }

    it('stores zero balance', async () => {
      await testBalanceAllocation(0, 0, 0);
    });

    it('stores partial zero balances', async () => {
      await testBalanceAllocation(42, 0, 0);
      await testBalanceAllocation(0, 23, 0);
      await testBalanceAllocation(0, 0, 10);

      await testBalanceAllocation(MAX_UINT112, 0, 0);
      await testBalanceAllocation(0, MAX_UINT112, 0);
      await testBalanceAllocation(0, 0, MAX_UINT32);
    });

    it('stores non-zero balances', async () => {
      await testBalanceAllocation(42, 23, 50);
      await testBalanceAllocation(MAX_UINT112.div(3), MAX_UINT112.div(3), MAX_UINT32.div(3));
    });

    it('stores extreme cash', async () => {
      await testBalanceAllocation(MAX_UINT112.sub(23), 23, 10000);
    });

    it('stores extreme managed', async () => {
      await testBalanceAllocation(42, MAX_UINT112.sub(42), 10000);
    });

    it('stores extreme balance', async () => {
      await testBalanceAllocation(MAX_UINT112.div(2), MAX_UINT112.div(2).add(1), 10000);
    });

    it('stores extreme block number', async () => {
      await testBalanceAllocation(42, 10, MAX_UINT32);
    });

    it('reverts on total overflow', async () => {
      await expect(testBalanceAllocation(MAX_UINT112, 1, 0)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testBalanceAllocation(1, MAX_UINT112, 0)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testBalanceAllocation(MAX_UINT112.div(2).add(1), MAX_UINT112.div(2).add(1), 0)).to.be.revertedWith(
        'BALANCE_TOTAL_OVERFLOW'
      );
    });
  });

  describe('cash', () => {
    describe('increase', () => {
      async function testIncreaseCash(cash: BigNumberish, managed: BigNumberish, amount: BigNumberish) {
        cash = bn(cash);
        managed = bn(managed);
        amount = bn(amount);

        const balance = await library.toBalance(cash, managed, BLOCK_NUMBER);
        const newBalance = await library.increaseCash(balance, amount);

        expect(await library.cash(newBalance)).to.equal(cash.add(amount)); // cash increases
        expect(await library.managed(newBalance)).to.equal(managed); // managed remains
        expect(await library.total(newBalance)).to.equal(cash.add(amount).add(managed)); // total increases

        // Updates the last change block
        const currentLastChangeBlock = await lastBlockNumber();
        expect(await library.lastChangeBlock(newBalance)).to.equal(currentLastChangeBlock);
        expect(await library.lastChangeBlock(balance)).to.equal(BLOCK_NUMBER);
      }

      it('increases cash by zero', async () => {
        await testIncreaseCash(0, 0, 0);

        await testIncreaseCash(42, 0, 0);
        await testIncreaseCash(0, 23, 0);
        await testIncreaseCash(42, 23, 0);

        await testIncreaseCash(MAX_UINT112.div(3), 0, 0);
        await testIncreaseCash(0, MAX_UINT112.div(4), 0);
        await testIncreaseCash(MAX_UINT112.div(3), MAX_UINT112.div(4), 0);
      });

      it('increases cash by non-zero', async () => {
        await testIncreaseCash(0, 0, 5);
        await testIncreaseCash(0, 0, MAX_UINT112.div(5));

        await testIncreaseCash(42, 0, 5);
        await testIncreaseCash(0, 23, 5);
        await testIncreaseCash(42, 23, 5);

        await testIncreaseCash(MAX_UINT112.div(3), 0, 5);
        await testIncreaseCash(0, MAX_UINT112.div(4), 5);
        await testIncreaseCash(MAX_UINT112.div(3), MAX_UINT112.div(4), 5);

        await testIncreaseCash(42, 0, MAX_UINT112.div(5));
        await testIncreaseCash(0, 23, MAX_UINT112.div(5));
        await testIncreaseCash(42, 23, MAX_UINT112.div(5));

        await testIncreaseCash(MAX_UINT112.div(3), 0, MAX_UINT112.div(5));
        await testIncreaseCash(0, MAX_UINT112.div(4), MAX_UINT112.div(5));
        await testIncreaseCash(MAX_UINT112.div(3), MAX_UINT112.div(4), MAX_UINT112.div(5));
      });

      it('increases cash to extreme amount', async () => {
        await testIncreaseCash(42, 0, MAX_UINT112.sub(42));
        await testIncreaseCash(42, 20, MAX_UINT112.sub(42 + 20));
      });

      it('reverts on cash overflow', async () => {
        await expect(testIncreaseCash(MAX_UINT112, 0, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
        await expect(testIncreaseCash(MAX_UINT112.div(2), 0, MAX_UINT112.div(2).add(2))).to.be.revertedWith(
          'BALANCE_TOTAL_OVERFLOW'
        );
      });

      it('reverts on total overflow', async () => {
        await expect(testIncreaseCash(0, MAX_UINT112, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
        await expect(testIncreaseCash(0, 1, MAX_UINT112)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
        await expect(testIncreaseCash(MAX_UINT112.div(2), MAX_UINT112.div(2), 2)).to.be.revertedWith(
          'BALANCE_TOTAL_OVERFLOW'
        );
      });
    });

    describe('decrease', () => {
      async function testDecreaseCash(cash: BigNumberish, managed: BigNumberish, amount: BigNumberish) {
        cash = bn(cash);
        managed = bn(managed);
        amount = bn(amount);

        const balance = await library.toBalance(cash, managed, BLOCK_NUMBER);
        const newBalance = await library.decreaseCash(balance, amount);

        expect(await library.cash(newBalance)).to.equal(cash.sub(amount)); // cash decreases
        expect(await library.managed(newBalance)).to.equal(managed); // external remains
        expect(await library.total(newBalance)).to.equal(cash.sub(amount).add(managed)); // total decreases

        // Updates the last change block
        const currentLastChangeBlock = await lastBlockNumber();
        expect(await library.lastChangeBlock(newBalance)).to.equal(currentLastChangeBlock);
        expect(await library.lastChangeBlock(balance)).to.equal(BLOCK_NUMBER);
      }

      it('decreases cash by zero', async () => {
        await testDecreaseCash(0, 0, 0);

        await testDecreaseCash(42, 0, 0);
        await testDecreaseCash(0, 23, 0);
        await testDecreaseCash(42, 23, 0);

        await testDecreaseCash(MAX_UINT112.div(3), 0, 0);
        await testDecreaseCash(0, MAX_UINT112.div(4), 0);
        await testDecreaseCash(MAX_UINT112.div(3), MAX_UINT112.div(4), 0);
      });

      it('decreases cash by non-zero', async () => {
        await testDecreaseCash(42, 0, 5);
        await testDecreaseCash(42, 23, 5);
        await testDecreaseCash(42, MAX_UINT112.div(4), 5);

        await testDecreaseCash(MAX_UINT112.div(3), 0, 5);
        await testDecreaseCash(MAX_UINT112.div(3), 23, 5);
        await testDecreaseCash(MAX_UINT112.div(3), MAX_UINT112.div(4), 5);

        await testDecreaseCash(MAX_UINT112.div(2), 0, MAX_UINT112.div(5));
        await testDecreaseCash(MAX_UINT112.div(2), 23, MAX_UINT112.div(5));
        await testDecreaseCash(MAX_UINT112.div(2), MAX_UINT112.div(4), MAX_UINT112.div(5));
      });

      it('decreases cash to zero', async () => {
        await testDecreaseCash(42, 0, 42);
        await testDecreaseCash(42, 20, 42);

        await testDecreaseCash(MAX_UINT112.sub(20), 20, MAX_UINT112.sub(20));
        await testDecreaseCash(MAX_UINT112.sub(20), 20, MAX_UINT112.sub(20));
      });

      it('reverts on negative cash', async () => {
        await expect(testDecreaseCash(0, 0, 1)).to.be.revertedWith('SUB_OVERFLOW');
        await expect(testDecreaseCash(1, 0, 2)).to.be.revertedWith('SUB_OVERFLOW');

        await expect(testDecreaseCash(MAX_UINT112.div(2), 0, MAX_UINT112.div(2).add(1))).to.be.revertedWith(
          'SUB_OVERFLOW'
        );
        await expect(testDecreaseCash(MAX_UINT112.div(2), 0, MAX_UINT112.div(2).add(1))).to.be.revertedWith(
          'SUB_OVERFLOW'
        );
      });
    });
  });

  describe('managed', () => {
    describe('cash to managed', () => {
      async function testCashToManaged(cash: BigNumberish, managed: BigNumberish, newManaged: BigNumberish) {
        cash = bn(cash);
        managed = bn(managed);
        newManaged = bn(newManaged);

        const balance = await library.toBalance(cash, managed, BLOCK_NUMBER);
        const newBalance = await library.cashToManaged(balance, newManaged);

        expect(await library.cash(newBalance)).to.equal(cash.sub(newManaged)); // cash decreases
        expect(await library.managed(newBalance)).to.equal(managed.add(newManaged)); // managed increases
        expect(await library.total(newBalance)).to.equal(cash.add(managed)); // total remains

        // Does not update the last change block
        expect(await library.lastChangeBlock(balance)).to.equal(BLOCK_NUMBER);
        expect(await library.lastChangeBlock(newBalance)).to.equal(BLOCK_NUMBER);
      }

      it('manages zero', async () => {
        await testCashToManaged(0, 0, 0);

        await testCashToManaged(42, 0, 0);
        await testCashToManaged(0, 23, 0);
        await testCashToManaged(42, 23, 0);

        await testCashToManaged(MAX_UINT112.div(2), MAX_UINT112.div(2).add(1), 0);
      });

      it('manages non-zero', async () => {
        await testCashToManaged(42, 0, 5);
        await testCashToManaged(42, 23, 5);

        await testCashToManaged(MAX_UINT112.div(2), 0, MAX_UINT112.div(4));
        await testCashToManaged(MAX_UINT112.div(2), MAX_UINT112.div(5), MAX_UINT112.div(4));
      });

      it('manages extreme amounts', async () => {
        await testCashToManaged(MAX_UINT112.sub(23), 23, MAX_UINT112.sub(23));
      });

      it('reverts when transferring more cash than available', async () => {
        await expect(testCashToManaged(0, 0, 1)).to.be.revertedWith('SUB_OVERFLOW');
        await expect(testCashToManaged(5, 0, 6)).to.be.revertedWith('SUB_OVERFLOW');

        await expect(testCashToManaged(MAX_UINT112.div(5), 23, MAX_UINT112.div(5).add(1))).to.be.revertedWith(
          'SUB_OVERFLOW'
        );
      });
    });

    describe('managed to cash', () => {
      async function testManagedToCash(cash: BigNumberish, managed: BigNumberish, newCash: BigNumberish) {
        cash = bn(cash);
        managed = bn(managed);
        newCash = bn(newCash);

        const balance = await library.toBalance(cash, managed, BLOCK_NUMBER);
        const newBalance = await library.managedToCash(balance, newCash);

        expect(await library.cash(newBalance)).to.equal(cash.add(newCash)); // cash increases
        expect(await library.managed(newBalance)).to.equal(managed.sub(newCash)); // external decreases
        expect(await library.total(newBalance)).to.equal(cash.add(managed)); // total remains

        // Does not update the last change block
        expect(await library.lastChangeBlock(balance)).to.equal(BLOCK_NUMBER);
        expect(await library.lastChangeBlock(newBalance)).to.equal(BLOCK_NUMBER);
      }

      it('cashes out zero', async () => {
        await testManagedToCash(0, 0, 0);

        await testManagedToCash(42, 0, 0);
        await testManagedToCash(0, 23, 0);
        await testManagedToCash(42, 23, 0);

        await testManagedToCash(MAX_UINT112.div(2), MAX_UINT112.div(2).add(1), 0);
      });

      it('cashes out non-zero', async () => {
        await testManagedToCash(42, 5, 5);
        await testManagedToCash(42, 23, 5);

        await testManagedToCash(0, MAX_UINT112.div(3), MAX_UINT112.div(4));
        await testManagedToCash(MAX_UINT112.div(2), MAX_UINT112.div(3), MAX_UINT112.div(4));
      });

      it('cashes out extreme amounts', async () => {
        await testManagedToCash(42, MAX_UINT112.sub(42), MAX_UINT112.sub(42));
      });

      it('reverts when cashing out more managed balance than available', async () => {
        await expect(testManagedToCash(0, 0, 1)).to.be.revertedWith('SUB_OVERFLOW');
        await expect(testManagedToCash(0, 5, 6)).to.be.revertedWith('SUB_OVERFLOW');

        await expect(testManagedToCash(42, MAX_UINT112.div(5), MAX_UINT112.div(5).add(1))).to.be.revertedWith(
          'SUB_OVERFLOW'
        );
      });
    });

    describe('set managed balance', () => {
      async function testSetManagedBalance(cash: BigNumberish, managed: BigNumberish, newManaged: BigNumberish) {
        cash = bn(cash);
        managed = bn(managed);

        const balance = await library.toBalance(cash, managed, BLOCK_NUMBER);
        const newBalance = await library.setManaged(balance, newManaged);

        expect(await library.cash(newBalance)).to.equal(cash);
        expect(await library.managed(newBalance)).to.equal(newManaged);
        expect(await library.total(newBalance)).to.equal(cash.add(newManaged));

        // Updates the last change block
        const currentLastChangeBlock = await lastBlockNumber();
        expect(await library.lastChangeBlock(balance)).to.equal(BLOCK_NUMBER);
        expect(await library.lastChangeBlock(newBalance)).to.equal(currentLastChangeBlock);
      }

      it('sets managed to zero', async () => {
        await testSetManagedBalance(0, 0, 0);

        await testSetManagedBalance(42, 0, 0);
        await testSetManagedBalance(0, 23, 0);
        await testSetManagedBalance(42, 23, 0);

        await testSetManagedBalance(MAX_UINT112, 0, 0);
        await testSetManagedBalance(0, MAX_UINT112, 0);
        await testSetManagedBalance(MAX_UINT112.div(2), MAX_UINT112.div(2), 0);
      });

      it('sets managed to non-zero', async () => {
        await testSetManagedBalance(0, 0, 58);

        await testSetManagedBalance(42, 0, 58);
        await testSetManagedBalance(0, 23, 58);
        await testSetManagedBalance(42, 23, 58);

        await testSetManagedBalance(MAX_UINT112.div(2), 0, 58);
        await testSetManagedBalance(0, MAX_UINT112.div(2), 58);
        await testSetManagedBalance(MAX_UINT112.div(2), MAX_UINT112.div(2), 58);
      });

      it('sets managed to extreme value', async () => {
        await testSetManagedBalance(42, 0, MAX_UINT112.sub(42));
        await testSetManagedBalance(0, 23, MAX_UINT112);
        await testSetManagedBalance(42, 23, MAX_UINT112.sub(42));
      });

      it('reverts on total overflow', async () => {
        await expect(testSetManagedBalance(MAX_UINT112, 0, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
        await expect(testSetManagedBalance(1, 0, MAX_UINT112)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
        await expect(testSetManagedBalance(MAX_UINT112.div(2).add(1), 0, MAX_UINT112.div(2).add(1))).to.be.revertedWith(
          'BALANCE_TOTAL_OVERFLOW'
        );
      });
    });
  });

  describe('shared balances', () => {
    async function testPackUnpack(
      cashA: BigNumberish,
      managedA: BigNumberish,
      cashB: BigNumberish,
      managedB: BigNumberish,
      lastChangeBlock?: BigNumberish
    ) {
      const balanceA = await library.toBalance(bn(cashA), bn(managedA), lastChangeBlock ?? BLOCK_NUMBER);
      const balanceB = await library.toBalance(bn(cashB), bn(managedB), lastChangeBlock ?? BLOCK_NUMBER);

      const sharedCash = await library.toSharedCash(balanceA, balanceB);
      const sharedManaged = await library.toSharedManaged(balanceA, balanceB);

      const unpackedBalanceA = await library.fromSharedToBalanceA(sharedCash, sharedManaged);
      const unpackedBalanceB = await library.fromSharedToBalanceB(sharedCash, sharedManaged);

      expect(unpackedBalanceA).to.equal(balanceA);
      expect(unpackedBalanceB).to.equal(balanceB);

      // Only shared cash holds the last change block
      expect(await library.lastChangeBlock(sharedCash)).to.equal(lastChangeBlock ?? BLOCK_NUMBER);
      expect(await library.lastChangeBlock(sharedManaged)).to.equal(0);
    }

    it('packs and unpacks zero balances', async () => {
      await testPackUnpack(0, 0, 0, 0);
    });

    it('packs and unpacks partial balances', async () => {
      await testPackUnpack(0, 0, 0, 0);
      await testPackUnpack(0, 0, 0, 2);
      await testPackUnpack(0, 0, 2, 0);
      await testPackUnpack(0, 0, 2, 2);
      await testPackUnpack(0, 2, 0, 0);
      await testPackUnpack(0, 2, 0, 2);
      await testPackUnpack(0, 2, 2, 0);
      await testPackUnpack(0, 2, 2, 2);
      await testPackUnpack(2, 0, 0, 0);
      await testPackUnpack(2, 0, 0, 2);
      await testPackUnpack(2, 0, 2, 0);
      await testPackUnpack(2, 0, 2, 2);
      await testPackUnpack(2, 2, 0, 0);
      await testPackUnpack(2, 2, 0, 2);
      await testPackUnpack(2, 2, 2, 0);
    });

    it('packs and unpacks extreme partial balances', async () => {
      const amount = MAX_UINT112.div(2);

      await testPackUnpack(0, 0, 0, 0);
      await testPackUnpack(0, 0, 0, amount);
      await testPackUnpack(0, 0, amount, 0);
      await testPackUnpack(0, 0, amount, amount);
      await testPackUnpack(0, amount, 0, 0);
      await testPackUnpack(0, amount, 0, amount);
      await testPackUnpack(0, amount, amount, 0);
      await testPackUnpack(0, amount, amount, amount);
      await testPackUnpack(amount, 0, 0, 0);
      await testPackUnpack(amount, 0, 0, amount);
      await testPackUnpack(amount, 0, amount, 0);
      await testPackUnpack(amount, 0, amount, amount);
      await testPackUnpack(amount, amount, 0, 0);
      await testPackUnpack(amount, amount, 0, amount);
      await testPackUnpack(amount, amount, amount, 0);
    });

    context('if A has a more recent last change block', () => {
      it('stores the most recent last change block', async () => {
        const balanceA = await library.toBalance(0, 0, 5);
        const balanceB = await library.toBalance(0, 0, 3);

        const sharedCash = await library.toSharedCash(balanceA, balanceB);
        const sharedManaged = await library.toSharedManaged(balanceA, balanceB);

        const unpackedBalanceA = await library.fromSharedToBalanceA(sharedCash, sharedManaged);

        expect(await library.lastChangeBlock(unpackedBalanceA)).to.equal(5);
      });
    });

    context('if B has a more recent last change block', () => {
      it('stores the most recent last change block', async () => {
        const balanceA = await library.toBalance(0, 0, 5);
        const balanceB = await library.toBalance(0, 0, 7);

        const sharedCash = await library.toSharedCash(balanceA, balanceB);
        const sharedManaged = await library.toSharedManaged(balanceA, balanceB);

        const unpackedBalanceA = await library.fromSharedToBalanceA(sharedCash, sharedManaged);

        expect(await library.lastChangeBlock(unpackedBalanceA)).to.equal(7);
      });
    });
  });

  describe('total balances', () => {
    async function testTotalBalances(cashBalances: BigNumberish[], managedBalances: BigNumberish[]) {
      const balances = await Promise.all(
        cashBalances.map((cash, i) => library.toBalance(bn(cash), bn(managedBalances[i]), BLOCK_NUMBER))
      );

      const expectedTotals = cashBalances.map((cash, i) => bn(cash).add(bn(managedBalances[i])));
      expect(await library.totals(balances)).to.deep.equal(expectedTotals);
    }

    it('handles zero balances', async () => {
      await testTotalBalances([0, 0], [0, 0]);
    });

    it('handles normal values', async () => {
      await testTotalBalances([10e18, 9e18], [5e18, 6e17]);
    });

    it('handles extreme cash values', async () => {
      await testTotalBalances([MAX_UINT112.sub(23), MAX_UINT112.sub(4)], [23, 4]);
    });

    it('handles extreme managed values', async () => {
      await testTotalBalances([42, 10], [MAX_UINT112.sub(42), MAX_UINT112.sub(10)]);
    });

    it('handles extreme values', async () => {
      await testTotalBalances(
        [MAX_UINT112.div(2), MAX_UINT112.div(2).add(1)],
        [MAX_UINT112.div(2).add(1), MAX_UINT112.div(2)]
      );
    });
  });

  describe('zeroed balances', () => {
    function itHandlesZeroedBalancesCorrectly(cash: number, managed: number, blockNumber: number) {
      it('handles zeroed balances correctly', async () => {
        const balance = await library.toBalance(cash, managed, blockNumber);

        const isZero = cash == 0 && managed == 0;
        await expect(await library.isZero(balance)).to.equal(isZero);
        await expect(await library.isNotZero(balance)).to.equal(!isZero);
      });
    }

    itHandlesZeroedBalancesCorrectly(0, 0, 0);
    itHandlesZeroedBalancesCorrectly(1, 0, 0);
    itHandlesZeroedBalancesCorrectly(0, 1, 0);
    itHandlesZeroedBalancesCorrectly(1, 1, 0);
    itHandlesZeroedBalancesCorrectly(0, 0, 1);
    itHandlesZeroedBalancesCorrectly(1, 0, 1);
    itHandlesZeroedBalancesCorrectly(0, 1, 1);
    itHandlesZeroedBalancesCorrectly(1, 1, 1);
  });
});
