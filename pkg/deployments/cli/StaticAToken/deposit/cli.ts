import { ethers } from 'hardhat';
import { ERC20__factory, StaticATokenLM__factory } from '@balancer-labs/typechain';
import chalk from 'chalk';
import prompts from 'prompts';
import { BigNumber } from 'ethers';

async function deposit(staticATokenAddress: string) {
  const deployer = (await ethers.getSigners())[0];
  const staticATokenContract = StaticATokenLM__factory.connect(staticATokenAddress, deployer);

  const staticATokenBalance = await staticATokenContract.balanceOf(deployer.address);
  console.log(chalk.bgYellow(chalk.black('balance static aToken')), chalk.yellow(staticATokenBalance.toString()));

  const underlyingToken = await staticATokenContract.ASSET();
  const underlyingTokenContract = ERC20__factory.connect(underlyingToken, deployer);

  const underlyingTokenName = await underlyingTokenContract.name();
  const underlyingTokenBalance = await underlyingTokenContract.balanceOf(deployer.address);
  console.log(chalk.bgYellow(chalk.black('balance underlying token')), chalk.yellow(underlyingTokenBalance.toString()));

  const aToken = await staticATokenContract.ATOKEN();
  const aTokenContract = ERC20__factory.connect(aToken, deployer);

  const aTokenName = await aTokenContract.name();
  const aTokenBalance = await aTokenContract.balanceOf(deployer.address);
  console.log(chalk.bgYellow(chalk.black('balance aToken')), chalk.yellow(aTokenBalance.toString()));

  const { deposit } = await prompts({
    type: 'select',
    name: 'deposit',
    message: 'deposit',
    choices: [
      { title: `aToken(${aTokenName})`, value: 'aToken' },
      { title: `underlying token (${underlyingTokenName})`, value: 'underlyingToken' },
    ],
  });
  const fromUnderlying = deposit === 'underlyingToken';

  const { amount } = await prompts({
    type: 'text',
    name: 'amount',
    message: 'amount',
  });
  const amountBN = BigNumber.from(amount);

  const depositedToken = fromUnderlying ? underlyingToken : aToken;
  const depositedTokenContract = ERC20__factory.connect(depositedToken, deployer);

  const approveTransaction = await depositedTokenContract.approve(staticATokenContract.address, amountBN);
  await approveTransaction.wait(2);

  const depositTransaction = await staticATokenContract.deposit(deployer.address, amountBN, 0, fromUnderlying);
  await depositTransaction.wait();

  const staticATokenBalancePost = await staticATokenContract.balanceOf(deployer.address);
  console.log(chalk.bgYellow(chalk.black('balance static aToken')), chalk.yellow(staticATokenBalancePost.toString()));
}

export default deposit;
