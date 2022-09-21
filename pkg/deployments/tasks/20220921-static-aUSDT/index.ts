import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';

import { ethers } from 'hardhat';

import {
  InitializableAdminUpgradeabilityProxy,
  InitializableAdminUpgradeabilityProxy__factory,
  StaticATokenLM,
  StaticATokenLM__factory,
} from '@balancer-labs/typechain';

const delay = (s: number) => new Promise((resolve) => setTimeout(resolve, s * 1000));

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const deployer = (await ethers.getSigners())[0];
  if (deployer) {
    const resultStaticATokenLM = await task.deployAndVerify('StaticATokenLM', [], from, force);

    const resultInitializableAdminUpgradeabilityProxy = await task.deployAndVerify(
      'InitializableAdminUpgradeabilityProxy',
      [],
      from,
      force
    );

    const staticATokenLMContract = StaticATokenLM__factory.connect(resultStaticATokenLM.address, deployer);

    const symbol = await staticATokenLMContract.symbol();
    console.log('symbol', symbol);

    const LENDING_POOL = await staticATokenLMContract.LENDING_POOL();
    console.log('LENDING_POOL', LENDING_POOL);

    const ASSET = await staticATokenLMContract.ASSET();
    console.log('ASSET', ASSET);

    const initializableAdminUpgradeabilityProxyContract = InitializableAdminUpgradeabilityProxy__factory.connect(
      resultInitializableAdminUpgradeabilityProxy.address,
      deployer
    );

    const data = staticATokenLMContract.interface.encodeFunctionData('initialize', [
      '0xF4dB3316D63891a2d45e66916810828d79c3C8ea',
      '0x72261bd935FDcf36c1Ecd25A499Ad226471BE722',
      'Wrapped hUSDT',
      'hUSDT',
    ]);
    const initializeTransaction = await initializableAdminUpgradeabilityProxyContract[
      'initialize(address,address,bytes)'
    ](resultStaticATokenLM.address, '0xbB91644F26b075bda47a13682DAD006eb9d70867', data);
    await initializeTransaction.wait(2);

    const staticATokenLMProxyContract = StaticATokenLM__factory.connect(
      resultInitializableAdminUpgradeabilityProxy.address,
      deployer
    );
    const LENDING_POOL_PROXY = await staticATokenLMProxyContract.LENDING_POOL();
    const ASSET_PROXY = await staticATokenLMProxyContract.ASSET();
    const ATOKEN_PROXY = await staticATokenLMProxyContract.ATOKEN();

    console.log('LENDING_POOL Proxy', LENDING_POOL_PROXY);
    console.log('ASSET Proxy', ASSET_PROXY);
    console.log('ATOKEN Proxy', ATOKEN_PROXY);
  }
};
