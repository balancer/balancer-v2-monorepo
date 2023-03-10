import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';

describeForkTest('CompoundV2Wrapping', 'bsc', 26028991, function () {
  let task: Task;
  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  const WBNB_HOLDER = '0xd7D069493685A581d27824Fc46EdA46B7EfC0063';
  const cWBNB = '0x92897f3De21E2FFa8dd8b3a48D1Edf29B5fCef0e';

  let wbnbToken: Contract, cToken: Contract;
  let sender: SignerWithAddress;
  let chainedReference: BigNumber;
  const amountToWrap = bn(1e18);

  before('run task', async () => {
    task = new Task('20230314-batch-relayer-v5', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    library = await task.deployedInstance('BatchRelayerLibrary');
    relayer = await task.instanceAt('BalancerRelayer', await library.getEntrypoint());
  });

  before('load vault and tokens', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));

    vault = await vaultTask.instanceAt('Vault', await library.getVault());
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
  });

  before('approve relayer at the authorizer', async () => {
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        vault.getActionId(vault.interface.getSighash(action))
      )
    );

    // We impersonate an account with the default admin role in order to be able to approve the relayer. This assumes
    // such an account exists.
    const admin = await impersonate(await authorizer.getRoleMember(await authorizer.DEFAULT_ADMIN_ROLE(), 0));

    // Grant relayer permission to call all relayer functions
    await authorizer.connect(admin).grantRoles(relayerActionIds, relayer.address);
  });

  before(async () => {
    wbnbToken = await task.instanceAt('IERC20', WBNB);
    cToken = await task.instanceAt('ICToken', cWBNB);
    sender = await impersonate(WBNB_HOLDER);

    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
  });

  it('should wrap successfully', async () => {
    const balanceOfwbnbBefore = await wbnbToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfcwbnbBefore = await cToken.balanceOf(relayer.address);

    expect(balanceOfcwbnbBefore).to.be.equal(0);

    // Approving vault to pull tokens from user.
    await wbnbToken.connect(sender).approve(vault.address, amountToWrap);

    chainedReference = toChainedReference(80);
    const depositIntoMidas = library.interface.encodeFunctionData('wrapCompoundV2', [
      cWBNB,
      sender.address,
      relayer.address,
      amountToWrap,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([depositIntoMidas]);

    const balanceOfwbnbAfter = await wbnbToken.balanceOf(sender.address);
    expect(balanceOfwbnbBefore.sub(balanceOfwbnbAfter)).to.be.equal(amountToWrap);
  });

  it('should unwrap successfully', async () => {
    const balanceOfwbnbBefore = await wbnbToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const cwbnbAmountToWithdraw = await cToken.balanceOf(relayer.address);
    const balanceOfcwbnbBefore = await cToken.balanceOf(relayer.address);

    expect(balanceOfcwbnbBefore).to.be.equal(cwbnbAmountToWithdraw);

    const withdrawFromMidas = library.interface.encodeFunctionData('unwrapCompoundV2', [
      cWBNB,
      relayer.address,
      sender.address,
      chainedReference,
      0,
    ]);

    await relayer.connect(sender).multicall([withdrawFromMidas]);

    const balanceOfwbnbAfter = await wbnbToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfcwbnbAfter = await cToken.balanceOf(relayer.address);

    expect(balanceOfcwbnbAfter).to.be.equal(0);
    expect(balanceOfwbnbAfter.sub(balanceOfwbnbBefore)).to.be.almostEqual(amountToWrap, 0.01);
  });
});

function toChainedReference(key: BigNumberish): BigNumber {
  const CHAINED_REFERENCE_PREFIX = 'ba10';
  // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
  const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

  return BigNumber.from(paddedPrefix).add(key);
}
