import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';

import { ethers } from 'hardhat';

import {
  InitializableAdminUpgradeabilityProxy,
  InitializableAdminUpgradeabilityProxy__factory,
  StaticATokenLM,
  StaticATokenLM__factory,
} from '@balancer-labs/typechain';

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

    const data = staticATokenLMContract.interface.encodeFunctionData('initialize', [
      '0xF4dB3316D63891a2d45e66916810828d79c3C8ea',
      '0x64D0B6c2D4d4850da25e80d04F8917dDc99c72fa',
      'Wrapped hUSDC',
      'hUSDC',
    ]);
    console.log('data', data);

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

    const initializeTransaction = await initializableAdminUpgradeabilityProxyContract[
      'initialize(address,address,bytes)'
    ](resultStaticATokenLM.address, '0xbB91644F26b075bda47a13682DAD006eb9d70867', data);
    const receiptInitialize = await initializeTransaction.wait(2);

    console.log(
      'receiptInitialize?.events',
      receiptInitialize?.events?.map((e) => e.event)
    );
    const initializedEvents = receiptInitialize?.events?.filter((e) => e.event === 'Initialized');
    if (initializedEvents && initializedEvents.length > 0) {
      const pool = initializedEvents[0].args?.pool;
      const aToken = initializedEvents[0].args?.aToken;
      const staticATokenName = initializedEvents[0].args?.staticATokenName;
      const staticATokenSymbol = initializedEvents[0].args?.staticATokenSymbol;
      console.log(pool, aToken, staticATokenName, staticATokenSymbol);
    }

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
