import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract, Signer } from 'ethers';
import { MAX_UINT256 } from '../helpers/constants';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { TokenList, deployTokens } from '../helpers/tokens';
import { deploy } from '../../scripts/helpers/deploy';
import { setupPool } from '../../scripts/helpers/pools';

describe('Vault - multiple trading strategies interfaces', () => {
  let controller: Signer;

  let vault: Contract;
  let mockStrategy: Contract;
  let mockScript: Contract;

  let trader: Signer;
  let tokens: TokenList = {};

  let poolIdPair: string;
  let poolIdTuple: string;

  before('setup', async () => {
    [, controller, trader] = await ethers.getSigners();
  });

  beforeEach(async () => {
    vault = await deploy('Vault');
    tokens = await deployTokens(['DAI', 'TEST']);

    mockStrategy = await deploy('MockTradingStrategy');
    mockScript = await deploy('MockTradeScript');

    poolIdPair = await setupPool(vault, mockStrategy, 0, tokens, controller, [
      ['DAI', 50],
      ['TEST', 50],
    ]);

    poolIdTuple = await setupPool(vault, mockStrategy, 1, tokens, controller, [
      ['DAI', 50],
      ['TEST', 50],
    ]);

    // Mint tokens for trader
    await tokens.DAI.mint(await trader.getAddress(), (300e18).toString());
    await tokens.TEST.mint(await trader.getAddress(), (300e18).toString());

    // Approve trade script by trader
    await tokens.DAI.connect(trader).approve(mockScript.address, MAX_UINT256);
    await tokens.TEST.connect(trader).approve(mockScript.address, MAX_UINT256);
  });

  it('has the correct curve', async () => {
    expect(await vault.getStrategy(poolIdPair)).to.have.members([mockStrategy.address, 0]);
    expect(await vault.getStrategy(poolIdTuple)).to.have.members([mockStrategy.address, 1]);
  });

  it('trades with tuple strategy pool', async () => {
    const diffs = [
      {
        token: tokens.DAI.address,
        vaultDelta: 0,
      },
      {
        token: tokens.TEST.address,
        vaultDelta: 0,
      },
    ];

    const swaps = [
      {
        poolId: poolIdTuple,
        tokenA: { tokenDiffIndex: 1, delta: (1e18).toString() },
        tokenB: { tokenDiffIndex: 0, delta: (-1e18).toString() },
      },
    ];

    const [preDAIBalance, preTESTBalance] = await vault.getPoolTokenBalances(poolIdTuple, [
      tokens.DAI.address,
      tokens.TEST.address,
    ]);

    await expectBalanceChange(
      async () => {
        // Send tokens & swap - would normally happen in the same tx
        await mockScript.batchSwap(
          vault.address,
          [tokens.TEST.address],
          [(1e18).toString()],
          diffs,
          swaps,
          await trader.getAddress(),
          await trader.getAddress(),
          true
        );
      },
      trader,
      tokens,
      { DAI: 1e18, TEST: -1e18 }
    );

    const [postDAIBalance, postTESTBalance] = await vault.getPoolTokenBalances(poolIdTuple, [
      tokens.DAI.address,
      tokens.TEST.address,
    ]);

    // DAI pool balance should decrease, TEST pool balance should increase
    expect(postDAIBalance.sub(preDAIBalance)).to.equal((-1e18).toString());
    expect(postTESTBalance.sub(preTESTBalance)).to.equal((1e18).toString());
  });

  it('trades with pair strategy product pool', async () => {
    const diffs = [
      {
        token: tokens.DAI.address,
        vaultDelta: 0,
      },
      {
        token: tokens.TEST.address,
        vaultDelta: 0,
      },
    ];

    const swaps = [
      {
        poolId: poolIdPair,
        tokenA: { tokenDiffIndex: 1, delta: (1e18).toString() },
        tokenB: { tokenDiffIndex: 0, delta: (-1e18).toString() },
      },
    ];

    const [preDAIBalance, preTESTBalance] = await vault.getPoolTokenBalances(poolIdTuple, [
      tokens.DAI.address,
      tokens.TEST.address,
    ]);

    await expectBalanceChange(
      async () => {
        // Send tokens & swap - would normally happen in the same tx
        await mockScript.batchSwap(
          vault.address,
          [tokens.TEST.address],
          [(1e18).toString()],
          diffs,
          swaps,
          await trader.getAddress(),
          await trader.getAddress(),
          true
        );
      },
      trader,
      tokens,
      { DAI: 1e18, TEST: -1e18 }
    );

    const [postDAIBalance, postTESTBalance] = await vault.getPoolTokenBalances(poolIdPair, [
      tokens.DAI.address,
      tokens.TEST.address,
    ]);

    // DAI pool balance should decrease, TEST pool balance should increase
    expect(postDAIBalance.sub(preDAIBalance)).to.equal((-1e18).toString());
    expect(postTESTBalance.sub(preTESTBalance)).to.equal((1e18).toString());
  });
});
