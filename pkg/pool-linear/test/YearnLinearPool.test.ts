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

describe('YearnLinearPool', function () {
  let pool: LinearPool, tokens: TokenList, mainToken: Token, wrappedToken: Token;
  let poolFactory: Contract;
  let trader: SignerWithAddress, lp: SignerWithAddress, owner: SignerWithAddress;
  let mockYearnTokenVault: Contract;
  const sharePrice = fp(1.05);

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, trader, owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy tokens', async () => {
    mainToken = await Token.create('DAI');
    mockYearnTokenVault = await deploy('MockYearnTokenVault', {
      args: ['yvDAI', 'yvDAI', 18, mainToken.address, sharePrice],
    });
    wrappedToken = await Token.deployedAt(mockYearnTokenVault.address);

    tokens = new TokenList([mainToken, wrappedToken]).sort();

    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  sharedBeforeEach('deploy pool factory', async () => {
    const vault = await Vault.create();
    poolFactory = await deploy('YearnLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address],
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
      expect(await pool.getWrappedTokenRate()).to.be.eq(sharePrice);
    });
  });
});