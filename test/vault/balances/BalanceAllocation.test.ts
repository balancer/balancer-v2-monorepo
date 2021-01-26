import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { MAX_UINT128 } from '../../../lib/helpers/constants';
import { deploy } from '../../../lib/helpers/deploy';

describe('Vault - cash/managed balance', () => {
  let library: Contract;

  before(async () => {
    library = await deploy('BalanceAllocationMock', { args: [] });
  });

  describe('cash, managed & total', () => {
    async function testBalanceAllocation(cashBalance: number | BigNumber, managedBalance: number | BigNumber) {
      cashBalance = BigNumber.from(cashBalance);
      managedBalance = BigNumber.from(managedBalance);

      const balance = await library.toBalance(cashBalance, managedBalance);

      expect(await library.cashBalance(balance)).to.equal(cashBalance);
      expect(await library.managedBalance(balance)).to.equal(managedBalance);
      expect(await library.totalBalance(balance)).to.equal(cashBalance.add(managedBalance));
    }

    it('stores zero balance', async () => {
      await testBalanceAllocation(0, 0);
    });

    it('stores partial zero balances', async () => {
      await testBalanceAllocation(42, 0);
      await testBalanceAllocation(0, 23);

      await testBalanceAllocation(MAX_UINT128, 0);
      await testBalanceAllocation(0, MAX_UINT128);
    });

    it('stores non-zero balances', async () => {
      await testBalanceAllocation(42, 23);
      await testBalanceAllocation(MAX_UINT128.div(3), MAX_UINT128.div(3));
    });

    it('stores extreme cash', async () => {
      await testBalanceAllocation(MAX_UINT128.sub(23), 23);
    });

    it('stores extreme managed', async () => {
      await testBalanceAllocation(42, MAX_UINT128.sub(42));
    });

    it('stores extreme balance', async () => {
      await testBalanceAllocation(MAX_UINT128.div(2), MAX_UINT128.div(2).add(1));
    });

    it('reverts on total overflow', async () => {
      await expect(testBalanceAllocation(MAX_UINT128, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testBalanceAllocation(1, MAX_UINT128)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testBalanceAllocation(MAX_UINT128.div(2).add(1), MAX_UINT128.div(2).add(1))).to.be.revertedWith(
        'BALANCE_TOTAL_OVERFLOW'
      );
    });
  });

  describe('set managed balance', () => {
    async function testSetManagedBalance(
      _cashBalance: number | BigNumber,
      _managedBalance: number | BigNumber,
      newManagedBalance: number | BigNumber
    ) {
      _cashBalance = BigNumber.from(_cashBalance);
      _managedBalance = BigNumber.from(_managedBalance);

      const balance = await library.setManagedBalance(
        await library.toBalance(_cashBalance, _managedBalance),
        newManagedBalance
      );

      expect(await library.cashBalance(balance)).to.equal(_cashBalance);
      expect(await library.managedBalance(balance)).to.equal(newManagedBalance);
      expect(await library.totalBalance(balance)).to.equal(_cashBalance.add(newManagedBalance));
    }

    it('sets external to zero', async () => {
      await testSetManagedBalance(0, 0, 0);

      await testSetManagedBalance(42, 0, 0);
      await testSetManagedBalance(0, 23, 0);
      await testSetManagedBalance(42, 23, 0);

      await testSetManagedBalance(MAX_UINT128, 0, 0);
      await testSetManagedBalance(0, MAX_UINT128, 0);
      await testSetManagedBalance(MAX_UINT128.div(2), MAX_UINT128.div(2), 0);
    });

    it('sets external to non-zero', async () => {
      await testSetManagedBalance(0, 0, 58);

      await testSetManagedBalance(42, 0, 58);
      await testSetManagedBalance(0, 23, 58);
      await testSetManagedBalance(42, 23, 58);

      await testSetManagedBalance(MAX_UINT128.div(2), 0, 58);
      await testSetManagedBalance(0, MAX_UINT128.div(2), 58);
      await testSetManagedBalance(MAX_UINT128.div(2), MAX_UINT128.div(2), 58);
    });

    it('sets external to extreme value', async () => {
      await testSetManagedBalance(42, 0, MAX_UINT128.sub(42));
      await testSetManagedBalance(0, 23, MAX_UINT128);
      await testSetManagedBalance(42, 23, MAX_UINT128.sub(42));
    });

    it('reverts on total overflow', async () => {
      await expect(testSetManagedBalance(MAX_UINT128, 0, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testSetManagedBalance(1, 0, MAX_UINT128)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testSetManagedBalance(MAX_UINT128.div(2).add(1), 0, MAX_UINT128.div(2).add(1))).to.be.revertedWith(
        'BALANCE_TOTAL_OVERFLOW'
      );
    });
  });

  describe('cash', () => {
    describe('increase', () => {
      async function testIncreaseCash(
        cash: number | BigNumber,
        managedBalance: number | BigNumber,
        increase: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        managedBalance = BigNumber.from(managedBalance);
        increase = BigNumber.from(increase);

        const balance = await library.toBalance(cash, managedBalance);
        const increased = await library.increaseCash(balance, increase);

        expect(await library.cashBalance(increased)).to.equal(cash.add(increase)); // cash increases
        expect(await library.managedBalance(increased)).to.equal(managedBalance); // managed remains
        expect(await library.totalBalance(increased)).to.equal(cash.add(increase).add(managedBalance)); // total increases
      }

      it('increases cash by zero', async () => {
        await testIncreaseCash(0, 0, 0);

        await testIncreaseCash(42, 0, 0);
        await testIncreaseCash(0, 23, 0);
        await testIncreaseCash(42, 23, 0);

        await testIncreaseCash(MAX_UINT128.div(3), 0, 0);
        await testIncreaseCash(0, MAX_UINT128.div(4), 0);
        await testIncreaseCash(MAX_UINT128.div(3), MAX_UINT128.div(4), 0);
      });

      it('increases cash by non-zero', async () => {
        await testIncreaseCash(0, 0, 5);
        await testIncreaseCash(0, 0, MAX_UINT128.div(5));

        await testIncreaseCash(42, 0, 5);
        await testIncreaseCash(0, 23, 5);
        await testIncreaseCash(42, 23, 5);

        await testIncreaseCash(MAX_UINT128.div(3), 0, 5);
        await testIncreaseCash(0, MAX_UINT128.div(4), 5);
        await testIncreaseCash(MAX_UINT128.div(3), MAX_UINT128.div(4), 5);

        await testIncreaseCash(42, 0, MAX_UINT128.div(5));
        await testIncreaseCash(0, 23, MAX_UINT128.div(5));
        await testIncreaseCash(42, 23, MAX_UINT128.div(5));

        await testIncreaseCash(MAX_UINT128.div(3), 0, MAX_UINT128.div(5));
        await testIncreaseCash(0, MAX_UINT128.div(4), MAX_UINT128.div(5));
        await testIncreaseCash(MAX_UINT128.div(3), MAX_UINT128.div(4), MAX_UINT128.div(5));
      });

      it('increases cash to extreme amount', async () => {
        await testIncreaseCash(42, 0, MAX_UINT128.sub(42));
        await testIncreaseCash(42, 20, MAX_UINT128.sub(42 + 20));
      });

      it('reverts on cash overflow', async () => {
        await expect(testIncreaseCash(MAX_UINT128, 0, 1)).to.be.revertedWith('ERR_ADD_OVERFLOW');
        await expect(testIncreaseCash(MAX_UINT128.div(2), 0, MAX_UINT128.div(2).add(2))).to.be.revertedWith(
          'ERR_ADD_OVERFLOW'
        );
      });

      it('reverts on total overflow', async () => {
        await expect(testIncreaseCash(0, MAX_UINT128, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
        await expect(testIncreaseCash(0, 1, MAX_UINT128)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
        await expect(testIncreaseCash(MAX_UINT128.div(2), MAX_UINT128.div(2), 2)).to.be.revertedWith(
          'BALANCE_TOTAL_OVERFLOW'
        );
      });
    });

    describe('decrease', () => {
      async function testDecreaseCash(
        cash: number | BigNumber,
        managedBalance: number | BigNumber,
        decrease: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        managedBalance = BigNumber.from(managedBalance);
        decrease = BigNumber.from(decrease);

        const balance = await library.toBalance(cash, managedBalance);
        const decreased = await library.decreaseCash(balance, decrease);

        expect(await library.cashBalance(decreased)).to.equal(cash.sub(decrease)); // cash decreases
        expect(await library.managedBalance(decreased)).to.equal(managedBalance); // external remains
        expect(await library.totalBalance(decreased)).to.equal(cash.sub(decrease).add(managedBalance)); // total decreases
      }

      it('decreases cash by zero', async () => {
        await testDecreaseCash(0, 0, 0);

        await testDecreaseCash(42, 0, 0);
        await testDecreaseCash(0, 23, 0);
        await testDecreaseCash(42, 23, 0);

        await testDecreaseCash(MAX_UINT128.div(3), 0, 0);
        await testDecreaseCash(0, MAX_UINT128.div(4), 0);
        await testDecreaseCash(MAX_UINT128.div(3), MAX_UINT128.div(4), 0);
      });

      it('decreases cash by non-zero', async () => {
        await testDecreaseCash(42, 0, 5);
        await testDecreaseCash(42, 23, 5);
        await testDecreaseCash(42, MAX_UINT128.div(4), 5);

        await testDecreaseCash(MAX_UINT128.div(3), 0, 5);
        await testDecreaseCash(MAX_UINT128.div(3), 23, 5);
        await testDecreaseCash(MAX_UINT128.div(3), MAX_UINT128.div(4), 5);

        await testDecreaseCash(MAX_UINT128.div(2), 0, MAX_UINT128.div(5));
        await testDecreaseCash(MAX_UINT128.div(2), 23, MAX_UINT128.div(5));
        await testDecreaseCash(MAX_UINT128.div(2), MAX_UINT128.div(4), MAX_UINT128.div(5));
      });

      it('decreases cash to zero', async () => {
        await testDecreaseCash(42, 0, 42);
        await testDecreaseCash(42, 20, 42);

        await testDecreaseCash(MAX_UINT128.sub(20), 20, MAX_UINT128.sub(20));
        await testDecreaseCash(MAX_UINT128.sub(20), 20, MAX_UINT128.sub(20));
      });

      it('reverts on negative cash', async () => {
        await expect(testDecreaseCash(0, 0, 1)).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        await expect(testDecreaseCash(1, 0, 2)).to.be.revertedWith('ERR_SUB_UNDERFLOW');

        await expect(testDecreaseCash(MAX_UINT128.div(2), 0, MAX_UINT128.div(2).add(1))).to.be.revertedWith(
          'ERR_SUB_UNDERFLOW'
        );
        await expect(testDecreaseCash(MAX_UINT128.div(2), 0, MAX_UINT128.div(2).add(1))).to.be.revertedWith(
          'ERR_SUB_UNDERFLOW'
        );
      });
    });
  });

  describe('managed', () => {
    describe('cash to managed', () => {
      async function testCashToManaged(
        cash: number | BigNumber,
        managedBalance: number | BigNumber,
        newManagedBalance: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        managedBalance = BigNumber.from(managedBalance);
        newManagedBalance = BigNumber.from(newManagedBalance);

        const balance = await library.toBalance(cash, managedBalance);
        const after = await library.cashToManaged(balance, newManagedBalance);

        expect(await library.cashBalance(after)).to.equal(cash.sub(newManagedBalance)); // cash decreases
        expect(await library.managedBalance(after)).to.equal(managedBalance.add(newManagedBalance)); // managed increases
        expect(await library.totalBalance(after)).to.equal(cash.add(managedBalance)); // total remains
      }

      it('manages zero', async () => {
        await testCashToManaged(0, 0, 0);

        await testCashToManaged(42, 0, 0);
        await testCashToManaged(0, 23, 0);
        await testCashToManaged(42, 23, 0);

        await testCashToManaged(MAX_UINT128.div(2), MAX_UINT128.div(2).add(1), 0);
      });

      it('manages non-zero', async () => {
        await testCashToManaged(42, 0, 5);
        await testCashToManaged(42, 23, 5);

        await testCashToManaged(MAX_UINT128.div(2), 0, MAX_UINT128.div(4));
        await testCashToManaged(MAX_UINT128.div(2), MAX_UINT128.div(5), MAX_UINT128.div(4));
      });

      it('manages extreme amounts', async () => {
        await testCashToManaged(MAX_UINT128.sub(23), 23, MAX_UINT128.sub(23));
      });

      it('reverts when transferring more cash than available', async () => {
        await expect(testCashToManaged(0, 0, 1)).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        await expect(testCashToManaged(5, 0, 6)).to.be.revertedWith('ERR_SUB_UNDERFLOW');

        await expect(testCashToManaged(MAX_UINT128.div(5), 23, MAX_UINT128.div(5).add(1))).to.be.revertedWith(
          'ERR_SUB_UNDERFLOW'
        );
      });
    });

    describe('external to cash', () => {
      async function testManagedToCash(
        cash: number | BigNumber,
        managedBalance: number | BigNumber,
        newCash: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        managedBalance = BigNumber.from(managedBalance);
        newCash = BigNumber.from(newCash);

        const balance = await library.toBalance(cash, managedBalance);
        const after = await library.managedToCash(balance, newCash);

        expect(await library.cashBalance(after)).to.equal(cash.add(newCash)); // cash increases
        expect(await library.managedBalance(after)).to.equal(managedBalance.sub(newCash)); // external decreases
        expect(await library.totalBalance(after)).to.equal(cash.add(managedBalance)); // total remains
      }

      it('cashes out zero', async () => {
        await testManagedToCash(0, 0, 0);

        await testManagedToCash(42, 0, 0);
        await testManagedToCash(0, 23, 0);
        await testManagedToCash(42, 23, 0);

        await testManagedToCash(MAX_UINT128.div(2), MAX_UINT128.div(2).add(1), 0);
      });

      it('cashes out non-zero', async () => {
        await testManagedToCash(42, 5, 5);
        await testManagedToCash(42, 23, 5);

        await testManagedToCash(0, MAX_UINT128.div(3), MAX_UINT128.div(4));
        await testManagedToCash(MAX_UINT128.div(2), MAX_UINT128.div(3), MAX_UINT128.div(4));
      });

      it('cashes out extreme amounts', async () => {
        await testManagedToCash(42, MAX_UINT128.sub(42), MAX_UINT128.sub(42));
      });

      it('reverts when cashing out more managed balance than available', async () => {
        await expect(testManagedToCash(0, 0, 1)).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        await expect(testManagedToCash(0, 5, 6)).to.be.revertedWith('ERR_SUB_UNDERFLOW');

        await expect(testManagedToCash(42, MAX_UINT128.div(5), MAX_UINT128.div(5).add(1))).to.be.revertedWith(
          'ERR_SUB_UNDERFLOW'
        );
      });
    });
  });

  describe('has managed balance', () => {
    async function testIsManaged(cash: number | BigNumber, managedBalance: number | BigNumber, expected: boolean) {
      cash = BigNumber.from(cash);
      managedBalance = BigNumber.from(managedBalance);

      const balance = await library.toBalance(cash, managedBalance);
      expect(await library.isManaged(balance)).to.equal(expected);
    }

    it('returns false if there is no managed balance', async () => {
      await testIsManaged(0, 0, false);
      await testIsManaged(1, 0, false);
      await testIsManaged(MAX_UINT128, 0, false);
    });

    it('returns true if there is an managed balance', async () => {
      await testIsManaged(0, 1, true);
      await testIsManaged(1, 1, true);
      await testIsManaged(MAX_UINT128.sub(1), 1, true);
      await testIsManaged(1, MAX_UINT128.sub(1), true);
    });
  });

  describe('shared balances', () => {
    async function testPackUnpack(
      cashA: number | BigNumber,
      externalA: number | BigNumber,
      cashB: number | BigNumber,
      externalB: number | BigNumber
    ) {
      const balanceA = await library.toBalance(BigNumber.from(cashA), BigNumber.from(externalA));
      const balanceB = await library.toBalance(BigNumber.from(cashB), BigNumber.from(externalB));

      const sharedCash = await library.toSharedCash(balanceA, balanceB);
      const sharedManaged = await library.toSharedManaged(balanceA, balanceB);

      const unpackedBalanceA = await library.fromSharedToBalanceA(sharedCash, sharedManaged);
      const unpackedBalanceB = await library.fromSharedToBalanceB(sharedCash, sharedManaged);

      expect(unpackedBalanceA).to.equal(balanceA);
      expect(unpackedBalanceB).to.equal(balanceB);
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
      const amount = MAX_UINT128.div(2);

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
  });
});
