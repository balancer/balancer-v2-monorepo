import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';

import { StablePoolEncoder } from '@balancer-labs/balancer-js';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

// An array of token amounts which will be added/removed to pool's balance on joins/exits
let tokenIncrements: BigNumber[];

describe('StakingRelayer', function () {
  let WETH: Token, DAI: Token, wstETH: Token;
  let basePoolId: string;
  let tokens: TokenList;
  let sender: SignerWithAddress, admin: SignerWithAddress, recipient: SignerWithAddress;
  let vault: Vault, basePool: StablePool;
  let stakingContract: Contract;
  let relayer: Contract;

  before('setup signers', async () => {
    [, admin, sender, recipient] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault, tokens, staking contract and relayer', async () => {
    vault = await Vault.create({ admin });

    DAI = await Token.create('DAI');

    const wethContract = await deployedAt('TestWETH', await vault.instance.WETH());
    WETH = new Token('WETH', 'WETH', 18, wethContract);

    const wstETHContract = await deploy('MockWstETH', { args: [WETH.address] });
    wstETH = new Token('wstETH', 'wstETH', 18, wstETHContract);

    tokens = new TokenList([DAI, WETH].sort());
    await tokens.mint({ to: sender, amount: fp(100) });
    await tokens.approve({ to: vault.address, amount: fp(100), from: sender });

    stakingContract = await deploy('v2-distributors/MultiRewards', {
      args: [vault.address],
    });

    relayer = await deploy('StakingRelayer', { args: [vault.address, wstETH.address, stakingContract.address] });

    basePool = await StablePool.create({ tokens, vault });
    basePoolId = basePool.poolId;

    // Seed liquidity in pool
    await WETH.mint(admin, fp(200));
    await WETH.approve(vault.address, MAX_UINT256, { from: admin });

    await DAI.mint(admin, fp(150));
    await DAI.approve(vault.address, MAX_UINT256, { from: admin });

    await basePool.init({ initialBalances: fp(100), from: admin });
  });

  sharedBeforeEach('mint tokens to sender', async () => {
    await WETH.mint(sender, fp(100));
    await WETH.approve(vault.address, fp(100), { from: sender });

    await DAI.mint(sender, fp(2500));
    await DAI.approve(vault.address, fp(150), { from: sender });
    tokenIncrements = Array(tokens.length).fill(fp(1));
  });

  describe('joinAndStake', () => {
    let joinRequest: { assets: string[]; maxAmountsIn: BigNumberish[]; userData: string; fromInternalBalance: boolean };

    sharedBeforeEach('build join request, relayer and staking contract', async () => {
      joinRequest = {
        assets: tokens.addresses,
        maxAmountsIn: tokenIncrements,
        userData: StablePoolEncoder.joinExactTokensInForBPTOut(tokenIncrements, 0),
        fromInternalBalance: false,
      };

      const joinAction = await actionId(vault.instance, 'joinPool');

      await vault.authorizer?.connect(admin).grantRoles([joinAction], relayer.address);
    });

    context('when the user approved the relayer', () => {
      sharedBeforeEach('allow relayer', async () => {
        await vault.instance.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
      });

      it('joins the pool and stakes the bpt', async () => {
        const receipt = await (
          await relayer.connect(sender).joinAndStake(basePoolId, recipient.address, joinRequest)
        ).wait();

        expectEvent.inIndirectReceipt(receipt, vault.instance.interface, 'PoolBalanceChanged', {
          poolId: basePoolId,
          liquidityProvider: sender.address,
        });

        expectEvent.inIndirectReceipt(receipt, stakingContract.interface, 'Staked', {
          pool: basePool.address,
          account: recipient.address,
        });
      });
    });
  });
});
