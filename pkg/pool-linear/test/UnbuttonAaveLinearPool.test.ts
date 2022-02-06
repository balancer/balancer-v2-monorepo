import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumberish } from 'ethers';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

const amplFP = (n: number) => fp(n / 10 ** 9);

const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

async function setupWrappedTokensAndLP(w1Rate: BigNumberish, w2Rate: BigNumberish): Promise<LinearPool> {
  const [deployer, owner] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  const ampl = await deploy('TestToken', {
    args: [deployerAddress, 'Mock Ampleforth', 'AMPL', 9],
  });
  await ampl.mint(deployerAddress, amplFP(2000), { from: deployerAddress });

  const wamplContract = await deploy('MockUnbuttonERC20', {
    args: [ampl.address, 'Mock Wrapped Ampleforth', 'wAMPL'],
  });
  await ampl.approve(wamplContract.address, MAX_UINT256, { from: deployerAddress });
  await wamplContract.connect(deployer).initialize(w1Rate);
  const mainToken = await Token.deployedAt(wamplContract.address);
  await wamplContract.connect(deployer).mint(fp(1));

  const aaveAMPLContract = await await deploy('MockAaveAMPLToken', {
    args: [ampl.address, 'Mock Aave Ampleforth', 'aAMPL'],
  });
  await ampl.approve(aaveAMPLContract.address, MAX_UINT256, { from: deployerAddress });
  await aaveAMPLContract.connect(deployer).initialize('1');
  await aaveAMPLContract.connect(deployer).mint(amplFP(1000));

  const wAaveAMPLContract = await deploy('MockUnbuttonERC20', {
    args: [aaveAMPLContract.address, 'Mock Wrapped Aave Ampleforth', 'wAAMPL'],
  });
  await aaveAMPLContract.approve(wAaveAMPLContract.address, MAX_UINT256, { from: deployerAddress });
  await wAaveAMPLContract.connect(deployer).initialize(w2Rate);
  const wrappedToken = await Token.deployedAt(wAaveAMPLContract.address);
  await wAaveAMPLContract.connect(deployer).mint(fp(1));

  const vault = await Vault.create();
  const poolContract = await deploy('UnbuttonAaveLinearPool', {
    args: [
      vault.address,
      'Balancer Pool Token',
      'BPT',
      mainToken.address,
      wrappedToken.address,
      bn(0),
      POOL_SWAP_FEE_PERCENTAGE,
      bn(0),
      bn(0),
      owner.address,
    ],
  });
  const pool = await LinearPool.deployedAt(poolContract.address);
  return pool;
}

describe('UnbuttonAaveLinearPool', function () {
  describe('getWrappedTokenRate with different wrapper exchange rates', () => {
    it('returns the expected value', async () => {
      const pool = await setupWrappedTokensAndLP('1000000000', '2000000000');
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(2));
    });

    it('returns the expected value', async () => {
      const pool = await setupWrappedTokensAndLP('2000000000', '1000000000');
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(0.5));
    });

    it('returns the expected value', async () => {
      const pool = await setupWrappedTokensAndLP('1000000000', '10000000000');
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(10));
    });

    it('returns the expected value', async () => {
      const pool = await setupWrappedTokensAndLP('10000000000', '1000000000');
      expect(await pool.getWrappedTokenRate()).to.be.eq(fp(0.1));
    });
  });

  describe('underlying mismatch', () => {
    it('should revert', async () => {
      const [deployer, owner] = await ethers.getSigners();
      const deployerAddress = await deployer.getAddress();

      const ampl = await deploy('TestToken', {
        args: [deployerAddress, 'Mock Ampleforth', 'AMPL', 9],
      });
      await ampl.mint(deployerAddress, amplFP(5), { from: deployerAddress });

      const dai = await deploy('TestToken', {
        args: [deployerAddress, 'DAI', 'DAI', 9],
      });
      await dai.mint(deployerAddress, amplFP(5), { from: deployerAddress });

      const wDAI = await deploy('MockUnbuttonERC20', {
        args: [dai.address, 'Mock Wrapped DAI', 'wDAI'],
      });
      await dai.approve(wDAI.address, MAX_UINT256, { from: deployerAddress });
      await wDAI.connect(deployer).initialize('1');
      const mainToken = await Token.deployedAt(wDAI.address);
      await wDAI.connect(deployer).mint(amplFP(1));

      const aaveAMPLContract = await await deploy('MockAaveAMPLToken', {
        args: [ampl.address, 'Mock Aave Ampleforth', 'aAMPL'],
      });
      await ampl.approve(aaveAMPLContract.address, MAX_UINT256, { from: deployerAddress });
      await aaveAMPLContract.connect(deployer).initialize('1');
      await aaveAMPLContract.connect(deployer).mint(amplFP(2));

      const wAaveAMPLContract = await deploy('MockUnbuttonERC20', {
        args: [aaveAMPLContract.address, 'Mock Wrapped Aave Ampleforth', 'wAAMPL'],
      });
      await aaveAMPLContract.approve(wAaveAMPLContract.address, MAX_UINT256, { from: deployerAddress });
      await wAaveAMPLContract.connect(deployer).initialize('1');
      const wrappedToken = await Token.deployedAt(wAaveAMPLContract.address);
      await wAaveAMPLContract.connect(deployer).mint(amplFP(1));

      const vault = await Vault.create();

      const deployTX = deploy('UnbuttonAaveLinearPool', {
        args: [
          vault.address,
          'Balancer Pool Token',
          'BPT',
          mainToken.address,
          wrappedToken.address,
          bn(0),
          POOL_SWAP_FEE_PERCENTAGE,
          bn(0),
          bn(0),
          owner.address,
        ],
      });
      await expect(deployTX).to.be.revertedWith('TOKENS_MISMATCH');
    });
  });
});
