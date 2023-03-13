import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StablePoolEncoder } from '@balancer-labs/balancer-js';
import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { defaultAbiCoder } from '@ethersproject/abi/lib/abi-coder';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { describeForkTest, getSigner, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';
import {
  DAI,
  USDC,
  amplificationParameter,
  cacheDurations,
  rateProviders,
  swapFeePercentage,
  tokens,
  initialBalances,
} from './helpers/sharedStableParams';

describeForkTest('Stable Phantom Exit', 'mainnet', 13776527, function () {
  let vault: Contract, authorizer: Contract;

  before('load vault and tokens', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));

    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
  });

  const LARGE_TOKEN_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';
  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  enum ExitKindPhantom {
    EXACT_BPT_IN_FOR_TOKENS_OUT = 0,
  }

  let owner: SignerWithAddress, whale: SignerWithAddress, govMultisig: SignerWithAddress;
  let pool: Contract, factory: Contract;
  let usdc: Contract, dai: Contract;
  let poolId: string;
  let stableTask: Task;
  let bptIndex: number;

  before('get signers', async () => {
    owner = await getSigner();
    whale = await impersonate(LARGE_TOKEN_HOLDER);
    govMultisig = await impersonate(GOV_MULTISIG);
  });

  before('run stable phantom pool task', async () => {
    stableTask = new Task('20211208-stable-phantom-pool', TaskMode.READ_ONLY, getForkedNetwork(hre));
    factory = await stableTask.deployedInstance('StablePhantomPoolFactory');
  });

  before('load tokens and approve', async () => {
    dai = await stableTask.instanceAt('IERC20', DAI);
    usdc = await stableTask.instanceAt('IERC20', USDC);

    await dai.connect(whale).approve(vault.address, MAX_UINT256);
    await usdc.connect(whale).approve(vault.address, MAX_UINT256);
  });

  before('create pool', async () => {
    const tx = await factory.create(
      'SP',
      'SPT',
      tokens,
      amplificationParameter,
      rateProviders,
      cacheDurations,
      swapFeePercentage,
      owner.address
    );
    const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

    pool = await stableTask.instanceAt('StablePhantomPool', event.args.pool);
    expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

    poolId = await pool.getPoolId();
    const [registeredAddress] = await vault.getPool(poolId);
    expect(registeredAddress).to.equal(pool.address);

    bptIndex = await pool.getBptIndex();

    const composableInitialBalances = Array.from({ length: tokens.length + 1 }).map((_, i) =>
      i == bptIndex ? 0 : i < bptIndex ? initialBalances[i] : initialBalances[i - 1]
    );
    const { tokens: allTokens } = await vault.getPoolTokens(poolId);

    const userData = StablePoolEncoder.joinInit(composableInitialBalances);
    await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
      assets: allTokens,
      maxAmountsIn: Array(tokens.length + 1).fill(MAX_UINT256),
      fromInternalBalance: false,
      userData,
    });
  });

  before('pause pool', async () => {
    await authorizer.connect(govMultisig).grantRole(await actionId(pool, 'setPaused'), govMultisig.address);
    await pool.connect(govMultisig).setPaused(true);
    const { paused } = await pool.getPausedState();

    expect(paused).to.be.true;
  });

  it('exits proportionally when paused', async () => {
    const previousBptBalance = await pool.balanceOf(owner.address);
    const bptIn = previousBptBalance.div(4);

    const { tokens: registeredTokens, balances: registeredBalances } = await vault.getPoolTokens(poolId);

    const tx = await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
      assets: registeredTokens,
      minAmountsOut: Array(registeredTokens.length).fill(0),
      fromInternalBalance: false,
      userData: defaultAbiCoder.encode(['uint256', 'uint256'], [ExitKindPhantom.EXACT_BPT_IN_FOR_TOKENS_OUT, bptIn]),
    });
    const receipt = await (await tx).wait();
    const { deltas } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    const amountsOut = deltas.map((x: BigNumber) => x.mul(-1));

    const expectedAmountsOut = (registeredBalances as BigNumber[]).map((b) => b.div(4));
    expectedAmountsOut[bptIndex] = bn(0);

    // Amounts out should be 1/4 the initial balances
    expect(amountsOut).to.equalWithError(expectedAmountsOut, 0.00001);

    // Make sure sent BPT is close to what we expect
    const currentBptBalance = await pool.balanceOf(owner.address);
    expect(currentBptBalance).to.be.equalWithError(bn(previousBptBalance).sub(bptIn), 0.001);
  });
});
