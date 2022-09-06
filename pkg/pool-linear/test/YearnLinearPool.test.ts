import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn, fp, scaleUp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';


describe('YearnLinearPool', function () {
  let poolFactory: Contract;
  let owner: SignerWithAddress;

  before('setup', async () => {
    [, , , owner] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy pool factory', async () => {
    const vault = await Vault.create();
    poolFactory = await deploy('YearnLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address],
    });
  });

  async function deployPool(mainTokenAddress: string, wrappedTokenAddress: string) {
    const tx = await poolFactory.create(
      'Linear pool',
      'BPT',
      mainTokenAddress,
      wrappedTokenAddress,
      bn(0),
      fp(0.01),
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    return LinearPool.deployedAt(event.args.pool);
  }

  describe('getWrappedTokenRate', () => {
    //The yearn vault pricePerShare is a decimal scaled version of getRate
    //for tokens with 6 decimals (USDC), pps is returned as 6 decimals
    //for tokens with 18 decimals (DAI), pps is returned as 18 decimals, etc, etc.
    //We test that under different circumstances, the wrappedTokenRate is always correct
    //and properly scaled to 18 decimals, regardless of token decimals.

    it('should return correct rates for 18 decimal tokens', async () => {
      const token = await Token.create('DAI');
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['yvDAI', 'yvDAI', 18, token.address, fp(1)],
      });

      const pool = await deployPool(token.address, tokenVault.address);

      await tokenVault.setPricePerShare(fp(1.05));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

      await tokenVault.setPricePerShare(fp(1.03));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.03));

      await tokenVault.setPricePerShare(fp(2.01));
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2.01));
    });

    it('should return correct rates for 6 decimal tokens', async () => {
      const token = await Token.create({ symbol: 'USDC', decimals: 6 });
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['yvUSDC', 'yvUSDC', 6, token.address, 1e6],
      });

      const pool = await deployPool(token.address, tokenVault.address);

      await tokenVault.setPricePerShare(1.05e6);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

      await tokenVault.setPricePerShare(1.03e6);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.03));

      await tokenVault.setPricePerShare(2.01e6);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2.01));
    });

    it('should return correct rates for 8 decimal tokens', async () => {
      const token = await Token.create({ symbol: 'wBTC', decimals: 6 });
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['yvBTC', 'yvBTC', 8, token.address, 1e8],
      });

      const pool = await deployPool(token.address, tokenVault.address);

      await tokenVault.setPricePerShare(1.05e8);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

      await tokenVault.setPricePerShare(1.03e8);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.03));

      await tokenVault.setPricePerShare(2.01e8);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2.01));
    });

    it('should return correct rates for 2 decimal tokens', async () => {
      const token = await Token.create({ symbol: 'TOKEN', decimals: 2 });
      const tokenVault = await deploy('MockYearnTokenVault', {
        args: ['TOKEN', 'TOKEN', 2, token.address, 1e2],
      });

      const pool = await deployPool(token.address, tokenVault.address);

      await tokenVault.setPricePerShare(1.05e2);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.05));

      await tokenVault.setPricePerShare(1.03e2);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(1.03));

      await tokenVault.setPricePerShare(2.01e2);
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2.01));
    });
  });
});