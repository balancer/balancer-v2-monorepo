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

    await delay(20);
    const resultInitializableAdminUpgradeabilityProxy = await task.deployAndVerify(
      'InitializableAdminUpgradeabilityProxy',
      [],
      from,
      force
    );
    await delay(20);

    const staticATokenLMContract = StaticATokenLM__factory.connect(resultStaticATokenLM.address, deployer);

    const initializeStaticATokenTransaction = await staticATokenLMContract.initialize(
      '0xF4dB3316D63891a2d45e66916810828d79c3C8ea',
      '0x72261bd935FDcf36c1Ecd25A499Ad226471BE722',
      'Wrapped aUSDT',
      'aUSDT'
    );
    await initializeStaticATokenTransaction.wait(2);

    const LENDING_POOL = await staticATokenLMContract.LENDING_POOL();
    console.log('LENDING_POOL', LENDING_POOL);
    // const initializableAdminUpgradeabilityProxyContract = InitializableAdminUpgradeabilityProxy__factory.connect(
    //   resultInitializableAdminUpgradeabilityProxy.address,
    //   deployer
    // );
    //
    // const data = staticATokenLMContract.interface.encodeFunctionData('initialize', [
    //   '0xF4dB3316D63891a2d45e66916810828d79c3C8ea',
    //   '0x72261bd935FDcf36c1Ecd25A499Ad226471BE722',
    //   'Wrapped aUSDT',
    //   'aUSDT',
    // ]);
    // const initializeTransaction = await initializableAdminUpgradeabilityProxyContract[
    //   'initialize(address,address,bytes)'
    // ](resultStaticATokenLM.address, deployer.address, data);
    // const receiptInitialize = await initializeTransaction.wait(2);
    //
    // const initializedEvents = receiptInitialize?.events?.filter((e) => e.event === 'Initialized');
    // if (initializedEvents && initializedEvents.length > 0) {
    //   const pool = initializedEvents[0].args?.pool;
    //   const aToken = initializedEvents[0].args?.aToken;
    //   const staticATokenName = initializedEvents[0].args?.staticATokenName;
    //   const staticATokenSymbol = initializedEvents[0].args?.staticATokenSymbol;
    //   console.log(pool, aToken, staticATokenName, staticATokenSymbol);
    // }

    // TODO: Proxy not working
  }
};
