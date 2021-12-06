import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';

import Task from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate, impersonateWhale, setBalance } from '../../../src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { RelayerAuthorization, SwapKind, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { fromNow, MINUTE } from '@balancer-labs/v2-helpers/src/time';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

describe('BatchRelayerLibrary', function () {
  const task = Task.forTest('20211203-batch-relayer', getForkedNetwork(hre));

  let relayer: Contract, library: Contract;
  let sender: SignerWithAddress, admin: SignerWithAddress;
  let vault: Contract, authorizer: Contract, dai: Contract, usdc: Contract;

  const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

  const DAI_USDC_USDT_POOL = '0x06df3b2bbb68adc8b0e302443692037ed9f91b42000000000000000000000063';
  const ETH_DAI_POOL = '0x0b09dea16768f0799065c475be02919503cb2a3500020000000000000000001a';

  const CHAINED_REFERENCE_PREFIX = 'ba10';
  function toChainedReference(key: BigNumberish): BigNumber {
    // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
    const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

    return BigNumber.from(paddedPrefix).add(key);
  }

  before('run task', async () => {
    await task.run({ force: true });
    library = await task.deployedInstance('BatchRelayerLibrary');
    relayer = await task.instanceAt('BalancerRelayer', await library.getEntrypoint());
  });

  before('load vault and tokens', async () => {
    const vaultTask = Task.forTest('20210418-vault', getForkedNetwork(hre));

    vault = await vaultTask.instanceAt('Vault', await library.getVault());
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    dai = await task.instanceAt('IERC20', DAI);
    usdc = await task.instanceAt('IERC20', USDC);
  });

  before('load signers', async () => {
    // We impersonate a whale that holds large token amounts, but can't use it directly as impersonation doesn't let us
    // sign messages. Therefore, we transfer its tokens to our sender.
    const whale = await impersonateWhale(fp(100));

    // The sender begins with just USDC and ETH
    sender = await getSigner();
    await usdc.connect(whale).transfer(sender.address, await usdc.balanceOf(whale.address));
    await setBalance(sender.address, fp(100));

    // We impersonate an account with the default admin role in order to be able to approve the relayer. This assumes
    // such an account exists.
    admin = await impersonate(await authorizer.getRoleMember(await authorizer.DEFAULT_ADMIN_ROLE(), 0), fp(100));
  });

  before('approve tokens by sender', async () => {
    // Even though the sender only starts with USDC, they will eventually get DAI and need to use it in the Vault
    await Promise.all(
      [usdc, dai].map(async (token) => await token.connect(sender).approve(vault.address, MAX_UINT256))
    );
  });

  before('approve relayer at the authorizer', async () => {
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        vault.getActionId(vault.interface.getSighash(action))
      )
    );

    // Grant relayer permission to call all relayer functions
    await authorizer.connect(admin).grantRoles(relayerActionIds, relayer.address);
  });

  afterEach('disapprove relayer by sender', async () => {
    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
  });

  async function getApprovalCalldata(deadline: BigNumber): Promise<string> {
    return library.interface.encodeFunctionData('setRelayerApproval', [
      relayer.address,
      true,
      RelayerAuthorization.encodeCalldataAuthorization(
        '0x',
        deadline,
        await RelayerAuthorization.signSetRelayerApprovalAuthorization(
          vault,
          sender,
          relayer,
          vault.interface.encodeFunctionData('setRelayerApproval', [sender.address, relayer.address, true]),
          deadline
        )
      ),
    ]);
  }

  it('sender can approve relayer, swap and join', async () => {
    const deadline = await fromNow(30 * MINUTE);

    // Swap USDC for DAI
    const swapCalldata = library.interface.encodeFunctionData('swap', [
      {
        poolId: DAI_USDC_USDT_POOL,
        kind: SwapKind.GivenIn,
        assetIn: USDC,
        assetOut: DAI,
        amount: await usdc.balanceOf(sender.address),
        userData: '0x',
      },
      {
        sender: sender.address,
        recipient: sender.address,
        fromInternalBalance: false,
        toInternalBalance: false,
      },
      0, // No min amount out
      deadline,
      0, // No eth
      toChainedReference(42),
    ]);

    // Use all DAI to join the ETH-DAI pool

    const { tokens: poolTokens } = await vault.getPoolTokens(ETH_DAI_POOL);
    const amountsIn = poolTokens.map((poolToken: string) =>
      poolToken.toLowerCase() == DAI.toLowerCase() ? toChainedReference(42) : 0
    );

    const joinCalldata = library.interface.encodeFunctionData('joinPool', [
      ETH_DAI_POOL,
      0, // Weighted Pool
      sender.address,
      sender.address,
      {
        assets: poolTokens,
        maxAmountsIn: amountsIn,
        userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(amountsIn, 0),
        fromInternalBalance: false,
      },
      0, // No eth
      0, // No output reference
    ]);

    await relayer.connect(sender).multicall([getApprovalCalldata(deadline), swapCalldata, joinCalldata]);

    const pool = await task.instanceAt('IERC20', ETH_DAI_POOL.slice(0, 42));
    expect(await pool.balanceOf(sender.address)).to.be.gt(0);
  });
});
