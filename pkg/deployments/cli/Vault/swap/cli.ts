import { ethers } from 'hardhat';
import { ERC20__factory, BasePool__factory, Vault__factory } from '@balancer-labs/typechain';
import chalk from 'chalk';
import { BigNumber } from 'ethers';
import prompts from 'prompts';

const MAX_BIG_NUMBER = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

async function swapCli(vaultAddress: string, poolAddress: string) {
  const deployer = (await ethers.getSigners())[0];

  const poolContract = BasePool__factory.connect(poolAddress, deployer);
  const vaultContract = Vault__factory.connect(vaultAddress, deployer);

  const poolId = await poolContract.getPoolId();
  const { tokens } = await vaultContract.getPoolTokens(poolId);

  const { tokenIn } = await prompts({
    type: 'select',
    name: 'tokenIn',
    message: `tokenIn`,
    choices: tokens.map((token) => ({ title: token, value: token })),
  });
  const { tokenOut } = await prompts({
    type: 'select',
    name: 'tokenOut',
    message: `tokenOut`,
    choices: tokens.map((token) => ({ title: token, value: token })),
  });

  const tokenInContract = ERC20__factory.connect(tokenIn, deployer);
  const tokenOutContract = ERC20__factory.connect(tokenOut, deployer);

  const decimals = await tokenInContract.decimals();

  const balanceInPre = await tokenInContract.balanceOf(deployer.address);
  const balanceOutPre = await tokenOutContract.balanceOf(deployer.address);

  console.log(chalk.bgYellow(chalk.black('balance token in')), chalk.yellow(balanceInPre.toString()));
  console.log(chalk.bgYellow(chalk.black('balance token out')), chalk.yellow(balanceOutPre.toString()));

  const { amount } = await prompts({
    type: 'text',
    name: 'amount',
    message: `amount (decimals: ${decimals})`,
  });
  const amountBN = BigNumber.from(amount);
  const allowance = await tokenInContract.allowance(deployer.address, vaultAddress);

  if (allowance.gt(amountBN)) {
    const approveTransaction = await tokenInContract.approve(vaultAddress, amountBN);
    await approveTransaction.wait(2);
  }

  const swapTransaction = await vaultContract.swap(
    {
      poolId,
      kind: 0,
      amount: amountBN,
      assetIn: tokenIn,
      assetOut: tokenOut,
      userData: '0x',
    },
    {
      sender: deployer.address,
      recipient: deployer.address,
      fromInternalBalance: false,
      toInternalBalance: false,
    },
    0,
    MAX_BIG_NUMBER
  );
  await swapTransaction.wait(2);

  const balanceInPost = await tokenInContract.balanceOf(deployer.address);
  const balanceOutPost = await tokenOutContract.balanceOf(deployer.address);

  console.log(chalk.bgGreen(chalk.black('balance token in')), chalk.green(balanceInPost.toString()));
  console.log(chalk.bgGreen(chalk.black('balance token out')), chalk.green(balanceOutPost.toString()));
}

export default swapCli;
