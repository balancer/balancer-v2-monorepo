import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { FundManagement, SingleSwap } from '@balancer-labs/balancer-js/src';

describe('TetuLinearPool', function () {
  let poolFactory: Contract;
  let lp: SignerWithAddress, owner: SignerWithAddress, arbitrager: SignerWithAddress;
  let vault: Vault;
  let funds: FundManagement;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, owner, arbitrager] = await ethers.getSigners();

    funds = {
      sender: lp.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: lp.address,
    };
  });

  sharedBeforeEach('deploy vault & pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    poolFactory = await deploy('TetuLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, queries.address],
    });
  });

  async function deployPool(mainTokenAddress: string, wrappedTokenAddress: string) {
    const tx = await poolFactory.create(
      'Linear pool',
      'BPT',
      mainTokenAddress,
      wrappedTokenAddress,
      fp(1_000_000),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    return LinearPool.deployedAt(event.args.pool);
  }

  describe('usdc vault with 6 decimals tests', () => {
    let usdc: Token;
    let xUSDC: Token;
    let usdcTetuVault: Contract;
    let bbtUSDC: LinearPool;

    sharedBeforeEach('setup tokens, tetu vault and linear pool', async () => {
      usdc = await Token.create({ symbol: 'USDC', name: 'USDC', decimals: 6 });
      usdcTetuVault = await deploy('MockTetuSmartVault', {
        args: ['xUSDC', 'xUSDC', 6, usdc.address, bn(1000000)],
      });
      xUSDC = await Token.deployedAt(usdcTetuVault.address);

      bbtUSDC = await deployPool(usdc.address, xUSDC.address);
      const initialJoinAmount = bn(100000000000);
      await usdc.mint(lp, initialJoinAmount);
      await usdc.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbtUSDC.poolId,
        kind: 0,
        assetIn: usdc.address,
        assetOut: bbtUSDC.address,
        amount: BigNumber.from(100_000e6),
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('Rebalancer should rebalance tokens according to target values', async () => {
      const {
        cash: usdCash,
        managed: usdManaged,
        assetManager: usdAssetManager,
      } = await vault.getPoolTokenInfo(bbtUSDC.poolId, usdc);

      const { cash: xUSDCash, managed: xUSDManaged } = await vault.getPoolTokenInfo(bbtUSDC.poolId, xUSDC);

      expect(usdCash).is.eq(bn(100000000000));
      expect(usdManaged).is.eq(0);

      expect(xUSDCash).is.eq(bn(0));
      expect(xUSDManaged).is.eq(0);

      // set target between 700_000 and 1_000_000 => 850_000
      await bbtUSDC.instance.connect(owner).setTargets(fp(7e4), fp(1e5));

      // 150_000 of main token (usdc) should be wrapped and invested to the tetuVault
      const rebalancer = await deployedAt('TetuLinearPoolRebalancer', usdAssetManager);
      await rebalancer.rebalance(arbitrager.address);

      const { cash: usdCashAfter1, managed: usdManagedAfter1 } = await vault.getPoolTokenInfo(bbtUSDC.poolId, usdc);
      expect(usdCashAfter1).is.eq(bn(8.5e10));
      // manages is 0 because usdc tokens were wrapped to xUsdc placed to the pool
      expect(usdManagedAfter1).is.eq(bn(0));

      const { cash: xUSDCashAfter1, managed: xUSDManagedAfter } = await vault.getPoolTokenInfo(bbtUSDC.poolId, xUSDC);
      expect(xUSDCashAfter1).is.eq(bn(1.5e10));
      expect(xUSDManagedAfter).is.eq(bn(0));

      // set target between 800_000 and 1_000_000 => 900_000
      await bbtUSDC.instance.connect(owner).setTargets(fp(8e4), fp(1e5));
      await rebalancer.rebalance(arbitrager.address);
      const { cash: usdCashAfter2 } = await vault.getPoolTokenInfo(bbtUSDC.poolId, usdc);
      expect(usdCashAfter2).is.eq(bn(9e10));
      const { cash: xUSDCashAfter2 } = await vault.getPoolTokenInfo(bbtUSDC.poolId, xUSDC);
      expect(xUSDCashAfter2).is.eq(bn(1e10));
    });
  });
});
