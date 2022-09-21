import { ethers } from 'hardhat';
import { ERC20__factory, BasePool__factory, Vault__factory } from '@balancer-labs/typechain';
import chalk from 'chalk';
import { BigNumber, BytesLike } from 'ethers';
import prompts from 'prompts';

const MAX_BIG_NUMBER = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

enum JoinKind {
  INIT,
  EXACT_TOKENS_IN_FOR_BPT_OUT,
  TOKEN_IN_FOR_EXACT_BPT_OUT,
}

async function joinCli(vaultAddress: string, poolAddress: string) {
  const deployer = (await ethers.getSigners())[0];

  const poolContract = BasePool__factory.connect(poolAddress, deployer);
  const vaultContract = Vault__factory.connect(vaultAddress, deployer);

  const poolId = await poolContract.getPoolId();
  const { tokens } = await vaultContract.getPoolTokens(poolId);

  const liquidityAmounts: BigNumber[] = [];
  for (const token of tokens) {
    const { token } = await prompts({
      type: 'select',
      name: 'token',
      message: `token`,
      choices: tokens.map((token) => ({ title: token, value: token })),
    });

    const tokenContract = ERC20__factory.connect(token, deployer);

    const decimals = await tokenContract.decimals();
    const balance = await tokenContract.balanceOf(deployer.address);

    console.log(chalk.bgYellow('balance'), chalk.yellow(balance.toString()));

    const { amount } = await prompts({
      type: 'text',
      name: 'amount',
      message: `amount (${decimals})`,
    });
    const amountBN = BigNumber.from(amount).mul(BigNumber.from(10).pow(decimals));
    const allowance = await tokenContract.allowance(deployer.address, vaultAddress);

    if (allowance.gte(amountBN)) {
      const approveTransaction = await tokenContract.approve(vaultAddress, amountBN);
      await approveTransaction.wait(2);
    }

    liquidityAmounts.push(amountBN);
  }

  const JOIN_KIND_INIT = JoinKind.INIT;
  const initUserData = ethers.utils.defaultAbiCoder.encode(
    ['uint256', 'uint256[]'],
    [JOIN_KIND_INIT, liquidityAmounts.map((amount) => amount.toString())]
  );

  const joinPoolRequest: {
    assets: string[];
    maxAmountsIn: BigNumber[];
    userData: BytesLike;
    fromInternalBalance: boolean;
  } = {
    assets: tokens,
    maxAmountsIn: liquidityAmounts,
    userData: initUserData,
    fromInternalBalance: false,
  };

  const joinPoolTransaction = await vaultContract.joinPool(poolId, deployer.address, deployer.address, joinPoolRequest);
  await joinPoolTransaction.wait(2);

  const liquidity = await poolContract.balanceOf(deployer.address);
  console.log(chalk.bgYellow('liquidity'), chalk.yellow(liquidity.toString()));
}

export default joinCli;
