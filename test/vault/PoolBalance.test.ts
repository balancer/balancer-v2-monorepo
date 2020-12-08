import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { MAX_UINT128 } from '../helpers/constants';

describe('Vault - pool balance', () => {
  let poolBalance: Contract;

  before(async () => {
    const PoolBalanceMockFactory = await ethers.getContractFactory('PoolBalanceMock');
    poolBalance = await PoolBalanceMockFactory.deploy();
  });

  describe('cash, invested & total', () => {
    async function testCashInvested(cash: number | BigNumber, invested: number | BigNumber) {
      cash = BigNumber.from(cash);
      invested = BigNumber.from(invested);

      const balance = await poolBalance.toBalance(cash, invested);

      expect(await poolBalance.cash(balance)).to.equal(cash);
      expect(await poolBalance.invested(balance)).to.equal(invested);
      expect(await poolBalance.total(balance)).to.equal(cash.add(invested));
    }

    it('stores zero balance', async () => {
      await testCashInvested(0, 0);
    });

    it('stores partial zero balances', async () => {
      await testCashInvested(42, 0);
      await testCashInvested(0, 23);

      await testCashInvested(MAX_UINT128, 0);
      await testCashInvested(0, MAX_UINT128);
    });

    it('stores non-zero balances', async () => {
      await testCashInvested(42, 23);
      await testCashInvested(MAX_UINT128.div(3), MAX_UINT128.div(3));
    });

    it('stores extreme cash', async () => {
      await testCashInvested(MAX_UINT128.sub(23), 23);
    });

    it('stores extreme invested', async () => {
      await testCashInvested(42, MAX_UINT128.sub(42));
    });

    it('stores extreme balance', async () => {
      await testCashInvested(MAX_UINT128.div(2), MAX_UINT128.div(2).add(1));
    });

    it('reverts on total overflow', async () => {
      await expect(testCashInvested(MAX_UINT128, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testCashInvested(1, MAX_UINT128)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testCashInvested(MAX_UINT128.div(2).add(1), MAX_UINT128.div(2).add(1))).to.be.revertedWith(
        'BALANCE_TOTAL_OVERFLOW'
      );
    });
  });

  describe('set invested', () => {
    async function testSetInvested(
      cash: number | BigNumber,
      invested: number | BigNumber,
      newInvested: number | BigNumber
    ) {
      cash = BigNumber.from(cash);
      invested = BigNumber.from(invested);

      const balance = await poolBalance.setInvested(await poolBalance.toBalance(cash, invested), newInvested);

      expect(await poolBalance.cash(balance)).to.equal(cash);
      expect(await poolBalance.invested(balance)).to.equal(newInvested);
      expect(await poolBalance.total(balance)).to.equal(cash.add(newInvested));
    }

    it('sets invested to zero', async () => {
      await testSetInvested(0, 0, 0);

      await testSetInvested(42, 0, 0);
      await testSetInvested(0, 23, 0);
      await testSetInvested(42, 23, 0);

      await testSetInvested(MAX_UINT128, 0, 0);
      await testSetInvested(0, MAX_UINT128, 0);
      await testSetInvested(MAX_UINT128.div(2), MAX_UINT128.div(2), 0);
    });

    it('sets invsted to non-zero', async () => {
      await testSetInvested(0, 0, 58);

      await testSetInvested(42, 0, 58);
      await testSetInvested(0, 23, 58);
      await testSetInvested(42, 23, 58);

      await testSetInvested(MAX_UINT128.div(2), 0, 58);
      await testSetInvested(0, MAX_UINT128.div(2), 58);
      await testSetInvested(MAX_UINT128.div(2), MAX_UINT128.div(2), 58);
    });

    it('sets invested to extreme value', async () => {
      await testSetInvested(42, 0, MAX_UINT128.sub(42));
      await testSetInvested(0, 23, MAX_UINT128);
      await testSetInvested(42, 23, MAX_UINT128.sub(42));
    });

    it('reverts on total overflow', async () => {
      await expect(testSetInvested(MAX_UINT128, 0, 1)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testSetInvested(1, 0, MAX_UINT128)).to.be.revertedWith('BALANCE_TOTAL_OVERFLOW');
      await expect(testSetInvested(MAX_UINT128.div(2).add(1), 0, MAX_UINT128.div(2).add(1))).to.be.revertedWith(
        'BALANCE_TOTAL_OVERFLOW'
      );
    });
  });

  describe('cash', () => {
    describe('increase', () => {
      async function testIncreaseCash(
        cash: number | BigNumber,
        invested: number | BigNumber,
        increase: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        invested = BigNumber.from(invested);
        increase = BigNumber.from(increase);

        const balance = await poolBalance.toBalance(cash, invested);
        const increased = await poolBalance.increaseCash(balance, increase);

        expect(await poolBalance.cash(increased)).to.equal(cash.add(increase)); // cash increases
        expect(await poolBalance.invested(increased)).to.equal(invested); // invested remains
        expect(await poolBalance.total(increased)).to.equal(cash.add(increase).add(invested)); // total increases
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
        invested: number | BigNumber,
        decrease: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        invested = BigNumber.from(invested);
        decrease = BigNumber.from(decrease);

        const balance = await poolBalance.toBalance(cash, invested);
        const decreased = await poolBalance.decreaseCash(balance, decrease);

        expect(await poolBalance.cash(decreased)).to.equal(cash.sub(decrease)); // cash decreases
        expect(await poolBalance.invested(decreased)).to.equal(invested); // invested remains
        expect(await poolBalance.total(decreased)).to.equal(cash.sub(decrease).add(invested)); // total decreases
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

  describe('invested', () => {
    describe('cash to invested', () => {
      async function testInvestCash(
        cash: number | BigNumber,
        invested: number | BigNumber,
        investment: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        invested = BigNumber.from(invested);
        investment = BigNumber.from(investment);

        const balance = await poolBalance.toBalance(cash, invested);
        const after = await poolBalance.cashToInvested(balance, investment);

        expect(await poolBalance.cash(after)).to.equal(cash.sub(investment)); // cash decreases
        expect(await poolBalance.invested(after)).to.equal(invested.add(investment)); // invested increases
        expect(await poolBalance.total(after)).to.equal(cash.add(invested)); // total remains
      }

      it('invests zero', async () => {
        await testInvestCash(0, 0, 0);

        await testInvestCash(42, 0, 0);
        await testInvestCash(0, 23, 0);
        await testInvestCash(42, 23, 0);

        await testInvestCash(MAX_UINT128.div(2), MAX_UINT128.div(2).add(1), 0);
      });

      it('invests non-zero', async () => {
        await testInvestCash(42, 0, 5);
        await testInvestCash(42, 23, 5);

        await testInvestCash(MAX_UINT128.div(2), 0, MAX_UINT128.div(4));
        await testInvestCash(MAX_UINT128.div(2), MAX_UINT128.div(5), MAX_UINT128.div(4));
      });

      it('invests extreme amounts', async () => {
        await testInvestCash(MAX_UINT128.sub(23), 23, MAX_UINT128.sub(23));
      });

      it('reverts when investing more cash than available', async () => {
        await expect(testInvestCash(0, 0, 1)).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        await expect(testInvestCash(5, 0, 6)).to.be.revertedWith('ERR_SUB_UNDERFLOW');

        await expect(testInvestCash(MAX_UINT128.div(5), 23, MAX_UINT128.div(5).add(1))).to.be.revertedWith(
          'ERR_SUB_UNDERFLOW'
        );
      });
    });

    describe('invested to cash', () => {
      async function testDivestCash(
        cash: number | BigNumber,
        invested: number | BigNumber,
        divestment: number | BigNumber
      ) {
        cash = BigNumber.from(cash);
        invested = BigNumber.from(invested);
        divestment = BigNumber.from(divestment);

        const balance = await poolBalance.toBalance(cash, invested);
        const after = await poolBalance.investedToCash(balance, divestment);

        expect(await poolBalance.cash(after)).to.equal(cash.add(divestment)); // cash increases
        expect(await poolBalance.invested(after)).to.equal(invested.sub(divestment)); // invested decreases
        expect(await poolBalance.total(after)).to.equal(cash.add(invested)); // total remains
      }

      it('divests zero', async () => {
        await testDivestCash(0, 0, 0);

        await testDivestCash(42, 0, 0);
        await testDivestCash(0, 23, 0);
        await testDivestCash(42, 23, 0);

        await testDivestCash(MAX_UINT128.div(2), MAX_UINT128.div(2).add(1), 0);
      });

      it('divests non-zero', async () => {
        await testDivestCash(42, 5, 5);
        await testDivestCash(42, 23, 5);

        await testDivestCash(0, MAX_UINT128.div(3), MAX_UINT128.div(4));
        await testDivestCash(MAX_UINT128.div(2), MAX_UINT128.div(3), MAX_UINT128.div(4));
      });

      it('divests extreme amounts', async () => {
        await testDivestCash(42, MAX_UINT128.sub(42), MAX_UINT128.sub(42));
      });

      it('reverts when divesting more investments than available', async () => {
        await expect(testDivestCash(0, 0, 1)).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        await expect(testDivestCash(0, 5, 6)).to.be.revertedWith('ERR_SUB_UNDERFLOW');

        await expect(testDivestCash(42, MAX_UINT128.div(5), MAX_UINT128.div(5).add(1))).to.be.revertedWith(
          'ERR_SUB_UNDERFLOW'
        );
      });
    });
  });
});
