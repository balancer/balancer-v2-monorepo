import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonateWhale } from '../../../src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';

describeForkTest('ComposableStablePool', 'mainnet', 16000000, function () { // 15225000
  let task: Task;

  let factory: Contract;
  let pool: Contract;
  let owner: SignerWithAddress;
  let whale: SignerWithAddress;
  let vault: Contract;
  let dai: Contract;
  let usdc: Contract;

  const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  const tokens = [DAI, USDC];
  const cacheDurations = [0, 0];
  const rateProviders = [ZERO_ADDRESS, ZERO_ADDRESS];
  const exemptFlags = [false, false];
  const amplificationParameter = bn(400);
  const swapFeePercentage = fp(0.01);
  
  before('run task', async () => {
    task = new Task('20221122-composable-stable-pool-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('ComposableStablePoolFactory');
  });

  before('load signers', async () => {
    owner = await getSigner();
    whale = await impersonateWhale(fp(100));
  });

  before('load vault and tokens', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', await factory.getVault());
    dai = await task.instanceAt('ERC20', DAI);
    usdc = await task.instanceAt('ERC20', USDC);
  });

  it('deploy a composable stable pool', async () => {
    expect(await factory.isPoolFromFactory(ZERO_ADDRESS)).to.be.false;

    const tx = await factory.create(
      'CSP',
      'CSBPT',
      tokens,
      amplificationParameter,
      rateProviders,
      cacheDurations,
      exemptFlags,
      swapFeePercentage,
      owner.address
    );

    const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');
    pool = await task.instanceAt('ComposableStablePool', event.args.pool);
    expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

    const poolId = pool.getPoolId();
    const [registeredAddress] = await vault.getPool(poolId);
    expect(registeredAddress).to.equal(pool.address);
  });
});
