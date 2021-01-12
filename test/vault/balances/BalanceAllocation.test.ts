import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { MAX_UINT128 } from '../../helpers/constants';
import { deploy } from '../../../scripts/helpers/deploy';

describe('Vault - cash/external balance', () => {
  let library: Contract;

  before(async () => {
    library = await deploy('BalanceAllocationMock', { args: [] });
  });

  describe('cash, external & total', () => {
    async function testBalanceAllocation(cashBalance: number | BigNumber, externalBalance: number | BigNumber) {
      cashBalance = BigNumber.from(cashBalance);
      externalBalance = BigNumber.from(externalBalance);

      const balance = await library.toBalance(cashBalance, externalBalance);

      expect(await library.cashBalance(balance)).to.equal(cashBalance);
      expect(await library.externalBalance(balance)).to.equal(externalBalance);
      expect(await library.totalBalance(balance)).to.equal(cashBalance.add(externalBalance));
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

    it('stores extreme external', async () => {
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

  describe('set external balance', () => {
    async function testSetExternalBalance(
      _cashBalance: number | BigNumber,
      _externalBalance: number | BigNumber,
      newExternalBalance: number | BigNumber
    ) {
      _cashBalance = BigNumber.from(_cashBalance);
      _externalBalance = BigNumber.from(_externalBalance);

      const balance = await library.setExternalBalance(
        await library.toBalance(_cashBalance, _externalBalance),
        newExternalBalance
      );

      expect(await library.cashBalance(balance)).to.equal(_cashBalance);
      expect(await library.externalBalance(balance)).to.equal(newExternalBalance);
      expect(await library.totalBalance(balance)).to.equal(_cashBalance.add(newExternalBalance));
    }

    it('sets external to zero', async () => {
      await testSetExternalBalance(0, 0, 0);

      await testSetExternalBalance(42, 0, 0);
      await testSetExternalBalance(0, 23, 0);
      await testSetExternalBalance(42, 23, 0);

      await testSetExternalBalance(MAX_UINT128, 0, 0);
      await testSetExternalBalance(0, MAX_UINT128, 0);
      await testSetExternalBalance(MAX_UINT128.div(2), MAX_UINT128.div(2), 0);
    });

    it('sets external to non-zero', async () => {
      await testSetExternalBalance(0, 0, 58);

      await testSetExternalBalance(42, 0, 58);
      await testSetExternalBalance(0, 23, 58);
      await testSetExternalBalance(42, 23, 58);

      await testSetExternalBalance(MAX_UINT128.div(2), 0, 58);
      await testSetExternalBalance(0, MAX_UINT128.div(2), 58);
      await testSetExternalBalance(MAX_UINT128.div(2), MAX_UINT128.div(2), 58);
    });

    it('sets external to extreme value', async () => {
      await testSetExternalBalance(42, 0, MAX_UINT128.sub(42));
      await testSetExternalBalance(0, 23, MAX_UINT128);
      await testSetExternalBalance(42, 23, MAX_UINT128.sub(42));
    });

    it('reverts on total overflow', async () => {
      await expect(testSetExternalBalance(MAX_UINT128, 0, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testSetExternalBalance(1, 0, MAX_UINT128)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testSetExternalBalance(MAX_UINT128.div(2).add(1), 0, MAX_UINT128.div(2).add(1))).to.be.revertedWith(
        'BALANCE_TOTAL_OVERFLOW'
      );
    });
  });

  describe('cash', () => {
    describe('increase', () => {
      async function testIncreaseCash(
        cash: number | BigNumber,
        externalBalance: number | BigNumber,
        increase: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        externalBalance = BigNumber.from(externalBalance);
        increase = BigNumber.from(increase);

        const balance = await library.toBalance(cash, externalBalance);
        const increased = await library.increaseCash(balance, increase);

        expect(await library.cashBalance(increased)).to.equal(cash.add(increase)); // cash increases
        expect(await library.externalBalance(increased)).to.equal(externalBalance); // external remains
        expect(await library.totalBalance(increased)).to.equal(cash.add(increase).add(externalBalance)); // total increases
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
        externalBalance: number | BigNumber,
        decrease: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        externalBalance = BigNumber.from(externalBalance);
        decrease = BigNumber.from(decrease);

        const balance = await library.toBalance(cash, externalBalance);
        const decreased = await library.decreaseCash(balance, decrease);

        expect(await library.cashBalance(decreased)).to.equal(cash.sub(decrease)); // cash decreases
        expect(await library.externalBalance(decreased)).to.equal(externalBalance); // external remains
        expect(await library.totalBalance(decreased)).to.equal(cash.sub(decrease).add(externalBalance)); // total decreases
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

  describe('external', () => {
    describe('cash to external', () => {
      async function testCashToExternal(
        cash: number | BigNumber,
        externalBalance: number | BigNumber,
        newExternalBalance: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        externalBalance = BigNumber.from(externalBalance);
        newExternalBalance = BigNumber.from(newExternalBalance);

        const balance = await library.toBalance(cash, externalBalance);
        const after = await library.cashToExternal(balance, newExternalBalance);

        expect(await library.cashBalance(after)).to.equal(cash.sub(newExternalBalance)); // cash decreases
        expect(await library.externalBalance(after)).to.equal(externalBalance.add(newExternalBalance)); // exeternal increases
        expect(await library.totalBalance(after)).to.equal(cash.add(externalBalance)); // total remains
      }

      it('manages zero', async () => {
        await testCashToExternal(0, 0, 0);

        await testCashToExternal(42, 0, 0);
        await testCashToExternal(0, 23, 0);
        await testCashToExternal(42, 23, 0);

        await testCashToExternal(MAX_UINT128.div(2), MAX_UINT128.div(2).add(1), 0);
      });

      it('manages non-zero', async () => {
        await testCashToExternal(42, 0, 5);
        await testCashToExternal(42, 23, 5);

        await testCashToExternal(MAX_UINT128.div(2), 0, MAX_UINT128.div(4));
        await testCashToExternal(MAX_UINT128.div(2), MAX_UINT128.div(5), MAX_UINT128.div(4));
      });

      it('manages extreme amounts', async () => {
        await testCashToExternal(MAX_UINT128.sub(23), 23, MAX_UINT128.sub(23));
      });

      it('reverts when transferring more cash than available', async () => {
        await expect(testCashToExternal(0, 0, 1)).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        await expect(testCashToExternal(5, 0, 6)).to.be.revertedWith('ERR_SUB_UNDERFLOW');

        await expect(testCashToExternal(MAX_UINT128.div(5), 23, MAX_UINT128.div(5).add(1))).to.be.revertedWith(
          'ERR_SUB_UNDERFLOW'
        );
      });
    });

    describe('external to cash', () => {
      async function testExternalToCash(
        cash: number | BigNumber,
        externalBalance: number | BigNumber,
        newCash: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        externalBalance = BigNumber.from(externalBalance);
        newCash = BigNumber.from(newCash);

        const balance = await library.toBalance(cash, externalBalance);
        const after = await library.externalToCash(balance, newCash);

        expect(await library.cashBalance(after)).to.equal(cash.add(newCash)); // cash increases
        expect(await library.externalBalance(after)).to.equal(externalBalance.sub(newCash)); // external decreases
        expect(await library.totalBalance(after)).to.equal(cash.add(externalBalance)); // total remains
      }

      it('cashes out zero', async () => {
        await testExternalToCash(0, 0, 0);

        await testExternalToCash(42, 0, 0);
        await testExternalToCash(0, 23, 0);
        await testExternalToCash(42, 23, 0);

        await testExternalToCash(MAX_UINT128.div(2), MAX_UINT128.div(2).add(1), 0);
      });

      it('cashes out non-zero', async () => {
        await testExternalToCash(42, 5, 5);
        await testExternalToCash(42, 23, 5);

        await testExternalToCash(0, MAX_UINT128.div(3), MAX_UINT128.div(4));
        await testExternalToCash(MAX_UINT128.div(2), MAX_UINT128.div(3), MAX_UINT128.div(4));
      });

      it('cashes out extreme amounts', async () => {
        await testExternalToCash(42, MAX_UINT128.sub(42), MAX_UINT128.sub(42));
      });

      it('reverts when cashing out more external balance than available', async () => {
        await expect(testExternalToCash(0, 0, 1)).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        await expect(testExternalToCash(0, 5, 6)).to.be.revertedWith('ERR_SUB_UNDERFLOW');

        await expect(testExternalToCash(42, MAX_UINT128.div(5), MAX_UINT128.div(5).add(1))).to.be.revertedWith(
          'ERR_SUB_UNDERFLOW'
        );
      });
    });
  });

  describe('has external balance', () => {
    async function testHasExternalBalance(
      cash: number | BigNumber,
      externalBalance: number | BigNumber,
      expected: boolean
    ) {
      cash = BigNumber.from(cash);
      externalBalance = BigNumber.from(externalBalance);

      const balance = await library.toBalance(cash, externalBalance);
      expect(await library.hasExternalBalance(balance)).to.equal(expected);
    }

    it('returns false if there is no external balance', async () => {
      await testHasExternalBalance(0, 0, false);
      await testHasExternalBalance(1, 0, false);
      await testHasExternalBalance(MAX_UINT128, 0, false);
    });

    it('returns true if there is an external balance', async () => {
      await testHasExternalBalance(0, 1, true);
      await testHasExternalBalance(1, 1, true);
      await testHasExternalBalance(MAX_UINT128.sub(1), 1, true);
      await testHasExternalBalance(1, MAX_UINT128.sub(1), true);
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
      const sharedExternal = await library.toSharedExternal(balanceA, balanceB);

      const unpackedBalanceA = await library.fromSharedToBalanceA(sharedCash, sharedExternal);
      const unpackedBalanceB = await library.fromSharedToBalanceB(sharedCash, sharedExternal);

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
