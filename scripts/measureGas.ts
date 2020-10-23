import { deploy } from './helpers/deploy';
import { ethers } from 'hardhat';
import { setupPool } from './helpers/pools';
import { deployTokens, mintTokens, TokenList } from '../test/helpers/tokens';
import { toFixedPoint } from './helpers/fixedPoint';
import { Contract } from 'ethers';
import { getDiffsSwapsAndAmounts } from './helpers/trading';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

let vault: Contract;
let script: Contract;
let tokens: TokenList;

let controller: SignerWithAddress;
let trader: SignerWithAddress;

const BATCHED_SWAP_TOTAL_POOLS = 8;

async function main() {
  [, controller, trader] = await ethers.getSigners();

  vault = await deploy('Vault');

  await vaultStats();

  script = await deploy('TradeScript', vault.address);

  tokens = await deployTokens(['DAI', 'MKR', 'BAT']);

  for (const symbol in tokens) {
    // controller tokens are used to initialize pools
    await mintTokens(tokens, symbol, controller, 100e18);
    // trader tokens are used to trade and not have non-zero balances
    await mintTokens(tokens, symbol, trader, 200e18);

    // deposit user balance for trader to make it non-zero
    await tokens[symbol].connect(trader).approve(vault.address, (100e18).toString());
    await vault.connect(trader).deposit(tokens[symbol].address, (1e18).toString(), trader.address);

    // Approve script to use tokens
    await tokens[symbol].connect(trader).approve(script.address, (100e18).toString());

    // Deposit tokens for script to use
    await tokens[symbol].connect(trader).approve(vault.address, (100e18).toString());
    await vault.connect(trader).deposit(tokens[symbol].address, (100e18).toString(), script.address);
  }

  await batchedSwap(false);
  await batchedSwap(true);
}

async function vaultStats() {
  console.log('# Vault');

  const deployReceipt = await ethers.provider.getTransactionReceipt(vault.deployTransaction.hash);
  console.log(`Deployment costs ${printGas(deployReceipt.gasUsed.toNumber())}`);

  const deployedBytecode = await ethers.provider.getCode(vault.address);
  const bytecodeSizeKb = deployedBytecode.slice(2).length / 2 / 1024;

  console.log(`Deployed bytecode size is ${bytecodeSizeKb} kB`);
}

async function batchedSwap(withdrawTokens: boolean) {
  console.log(
    `# Batched swap: multiple batched pools for the same pair ${withdrawTokens ? '' : 'not withdrawing tokens'}`
  );

  // 50-50 DAI-MKR pools

  const pools: Array<string> = [];
  const curve = await deploy('ConstantWeightedProdStrategy', [tokens.MKR.address, tokens.DAI.address], [50, 50], 2, 0);
  for (let i = 0; i < BATCHED_SWAP_TOTAL_POOLS; ++i) {
    pools.push(
      await setupPool(vault, curve, 0, tokens, controller, [
        ['DAI', 50],
        ['MKR', 50],
      ])
    );
  }

  // Trade DAI for MKR, putting 500 DAI into each pool

  for (let poolAmount = 1; poolAmount <= BATCHED_SWAP_TOTAL_POOLS; ++poolAmount) {
    const [diffs, swaps, amounts] = getDiffsSwapsAndAmounts(
      tokens,
      pools.slice(0, poolAmount).map((poolId) => {
        return { poolId, tokenIn: 'DAI', tokenOut: 'MKR', amount: 500 };
      })
    );

    const receipt = await (
      await script
        .connect(trader)
        .swapExactAmountIn(
          tokens.DAI.address,
          tokens.MKR.address,
          500 * poolAmount,
          toFixedPoint(1),
          diffs,
          swaps,
          amounts,
          withdrawTokens
        )
    ).wait();

    console.log(
      `Using ${poolAmount} pools: ${printGas(receipt.gasUsed)} (${printGas(receipt.gasUsed / poolAmount)} per pool)`
    );
  }
}

function printGas(gas: number): string {
  return `${Math.trunc(gas / 1000)}k`;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
