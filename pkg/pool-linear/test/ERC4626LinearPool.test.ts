import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

describe('ERC4626LinearPool', function () {
  let pool: LinearPool, tokens: TokenList, token: Token, rebasingYieldToken: Token, wrappedYieldToken: Token;
  let poolFactory: Contract;
  let wrappedYieldTokenInstance: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, trader, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    token = await Token.create({ symbol: 'USDC', decimals: 6 });
    rebasingYieldToken = await Token.create({ symbol: 'USD+', decimals: 6 });
    wrappedYieldTokenInstance = await deploy('MockERC4626Token', {
      args: ['stUSD+', 'stUSD+', 12, rebasingYieldToken.address],
    });
    wrappedYieldToken = await Token.deployedAt(wrappedYieldTokenInstance.address);

    tokens = new TokenList([token, rebasingYieldToken]).sort();

    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  sharedBeforeEach('deploy pool factory', async () => {
    const vault = await Vault.create();
    poolFactory = await deploy('ERC4626LinearPoolFactory', {
      args: [vault.address],
    });
  });

  describe('getWrappedTokenRate', () => {
    sharedBeforeEach('deploy and initialize pool', async () => {
      const tx = await poolFactory.create(
        'Balancer Pool Token',
        'BPT',
        token.address,
        wrappedYieldToken.address,
        bn(0),
        POOL_SWAP_FEE_PERCENTAGE,
        owner.address
      );

      const receipt = await tx.wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');

      pool = await LinearPool.deployedAt(event.args.pool);
    });

    it('returns the expected value', async () => {
      // Rate should be at wrapped token decimals main token decimals minus and upped to e18
      // Ex. for main 6 and wrapped 12 it should be at 18-6+12=12 scale
      await wrappedYieldTokenInstance.setRate(bn(1e12));

      await wrappedYieldTokenInstance.deposit(bn(1e6), trader.address);
      expect(await wrappedYieldTokenInstance.totalSupply()).to.be.eq(bn(1e12));
      expect(await wrappedYieldTokenInstance.totalAssets()).to.be.eq(bn(1e6));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

      // await wrappedYieldTokenInstance.connect(trader).approve(owner.address, bn(1e12));
      await wrappedYieldTokenInstance.redeem(bn(1e12), owner.address, trader.address);
      expect(await wrappedYieldTokenInstance.totalSupply()).to.be.eq(0);
      expect(await wrappedYieldTokenInstance.totalAssets()).to.be.eq(0);

      // rate is e18 on empty pool
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

      // We now double the exchange rate to 2:1
      await wrappedYieldTokenInstance.setRate(bn(2e12));

      await wrappedYieldTokenInstance.deposit(bn(1e6), trader.address);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));

      // on rate 2:1 we got fewer shares
      expect(await wrappedYieldTokenInstance.totalSupply()).to.be.eq(bn(5e11));
      await wrappedYieldTokenInstance.redeem(bn(5e11), owner.address, trader.address);

      // We now set the exchange rate to 1.25:1.00
      await wrappedYieldTokenInstance.setRate(bn(1250000000000));

      await wrappedYieldTokenInstance.deposit(bn(1e6), trader.address);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.25));
      await wrappedYieldTokenInstance.redeem(bn(800000000000), owner.address, trader.address);
    });
  });
});
