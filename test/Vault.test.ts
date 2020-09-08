import { ethers } from '@nomiclabs/buidler';
import { expect } from 'chai';
import { ContractFactory, Contract, Signer, BigNumber, ContractReceipt } from 'ethers';
import * as expectEvent from './helpers/expectEvent';
import { MAX_UINT256 } from './helpers/constants';

describe('Vault', () => {
  let controller: Signer;
  let trader: Signer;

  let VaultFactory: ContractFactory;
  let vault: Contract;

  let TestTokenFactory: ContractFactory;
  let tokens: { [symbol: string]: Contract } = {};

  async function deployToken(symbol: string, decimals?: Number) {
    const token = await (await TestTokenFactory.deploy(symbol, symbol, decimals ?? 18)).deployed();
    tokens[symbol] = token;
  }

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();

    VaultFactory = await ethers.getContractFactory('Vault');
    TestTokenFactory = await ethers.getContractFactory('TestToken');

    await deployToken('DAI');
    await deployToken('MKR');
  });

  beforeEach('deploy vault', async () => {
    vault = await (await VaultFactory.deploy()).deployed();
  });

  describe('pool management', () => {
    let poolId: BigNumber;

    beforeEach('add pool', async () => {
      const receipt: ContractReceipt = await (await vault.connect(controller).newPool()).wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');

      poolId = event.args!.poolId;
    });

    it('has the correct controller', async () => {
      expect(await vault.getController(poolId)).to.equal(await controller.getAddress());
    });
  });

  describe('batch swap', () => {
    const totalPools = 5;

    beforeEach('setup pools & mint tokens', async () => {
      // Mint and approve controller liquidity
      await Promise.all(['DAI', 'MKR'].map(async token => {
        await tokens[token].mint(await controller.getAddress(), 100e18.toString());
        await tokens[token].connect(controller).approve(vault.address, MAX_UINT256);
      }));


      for (let poolId = 0; poolId < totalPools; ++poolId) {
        const receipt: ContractReceipt = await (await vault.connect(controller).newPool()).wait();
        expectEvent.inReceipt(receipt, 'PoolCreated', { poolId });

        // 50-50 DAI-MKR pool with 1e18 tokens in each
        await vault.connect(controller).bind(poolId, tokens['DAI'].address, 1e18.toString(), 1e18.toString());
        await vault.connect(controller).bind(poolId, tokens['MKR'].address, 1e18.toString(), 1e18.toString());
      }

      // Mint tokens for trader
      await tokens['DAI'].mint(await trader.getAddress(), 1e18.toString());
      await tokens['MKR'].mint(await trader.getAddress(), 1e18.toString());
    });

    it('single pair single pool swap', async () => {
      // Trade 1e18 MKR for 0.5e18 DAI

      const diffs = [{
        token: tokens['DAI'].address,
        vaultDelta: 0
      }, {
        token: tokens['MKR'].address,
        vaultDelta: 0
      }];

      const swaps = [
        {
          poolId: 0,
          tokenA: { tokenPoolIndex: 0, tokenDiffIndex: 0, balance: 0.51e18.toString() }, // Math isn't 100% accurate
          tokenB: { tokenPoolIndex: 1, tokenDiffIndex: 1, balance: 2e18.toString() },
        }
      ];

      // Send tokens & swap - would normally happen in the same tx
      await tokens['MKR'].connect(trader).transfer(vault.address, 1e18.toString());
      const receipt = await (await vault.connect(trader).batchSwap(diffs, swaps)).wait();

      // console.log('Gas:', receipt.gasUsed.toString());
    });

    it('single pair multi pool (batch) swap', async () => {
      // Trade 0.68e18 MKR for 0.5e18 DAI

      const diffs = [{
        token: tokens['DAI'].address,
        vaultDelta: 0
      }, {
        token: tokens['MKR'].address,
        vaultDelta: 0
      }];

      const swaps = [
        {
          poolId: 0,
          tokenA: { tokenPoolIndex: 0, tokenDiffIndex: 0, balance: 0.75e18.toString() },
          tokenB: { tokenPoolIndex: 1, tokenDiffIndex: 1, balance: 1.34e18.toString() },
        },{
          poolId: 1,
          tokenA: { tokenPoolIndex: 0, tokenDiffIndex: 0, balance: 0.75e18.toString() },
          tokenB: { tokenPoolIndex: 1, tokenDiffIndex: 1, balance: 1.34e18.toString() },
        }
      ];

      // Send tokens & swap - would normally happen in the same tx
      await tokens['MKR'].connect(trader).transfer(vault.address, 0.68e18.toString());
      const receipt = await (await vault.connect(trader).batchSwap(diffs, swaps)).wait();

      // console.log('Gas:', receipt.gasUsed.toString());
    });
  });
});
