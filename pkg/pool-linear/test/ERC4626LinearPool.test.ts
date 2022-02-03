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
  let pool: LinearPool, tokens: TokenList, mainToken: Token, wrappedToken: Token;
  let poolFactory: Contract;
  let wrappedTokenInstance: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, trader, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    const [deployer] = await ethers.getSigners();

    mainToken = await Token.create('USD+');
    wrappedTokenInstance = await deploy('MockERC4626Token', {
      args: [deployer.address, 'stUSD+', 'stUSD+', 6, mainToken.address],
    });
    wrappedToken = await Token.deployedAt(wrappedTokenInstance.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();

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
        mainToken.address,
        wrappedToken.address,
        bn(0),
        POOL_SWAP_FEE_PERCENTAGE,
        owner.address
      );

      const receipt = await tx.wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');

      pool = await LinearPool.deployedAt(event.args.pool);
    });

    it('returns the expected value', async () => {
      // Reserve's normalised income is stored with 27 decimals (i.e. a 'ray' value)
      // 1e27 implies a 1:1 exchange rate between main and wrapped token
      await wrappedTokenInstance.setRate(bn(1e27));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1));

      // We now double the reserve's normalised income to change the exchange rate to 2:1
      await wrappedTokenInstance.setRate(bn(2e27));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));
    });
  });

  describe('constructor', () => {
    it('reverts if the mainToken is not the mainToken of the wrappedToken', async () => {
      const otherToken = await Token.create('USDC');

      await expect(
        poolFactory.create(
          'Balancer Pool Token',
          'BPT',
          otherToken.address,
          wrappedToken.address,
          bn(0),
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address
        )
      ).to.be.revertedWith('TOKENS_MISMATCH');
    });
  });
});
