import { expect } from 'chai';
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
import { MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

describe('LidoBatchRelayer', function () {
  let tokens: TokenList, basePoolTokens: TokenList, metaPoolTokens: TokenList;
  let wstETH: Token;
  let basePoolId: string, metaPoolId: string;
  let sender: SignerWithAddress, recipient: SignerWithAddress, admin: SignerWithAddress;
  let vault: Vault, basePool: StablePool, metaPool: StablePool;
  let relayer: Contract, stakingContract: Contract;

  // An array of token amounts which will be added/removed to pool's balance on joins/exits
  let tokenIncrements: BigNumber[];

  before('setup signer', async () => {
    [, admin, sender, recipient] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy relayer', async () => {
    vault = await Vault.create({ admin });
    stakingContract = await deploy('v2-distributors/MultiRewards', {
      args: [vault.address],
    });

    const DAI = await Token.create('DAI');
    const wethContract = await deployedAt('TestWETH', await vault.instance.WETH());
    const WETH = new Token('WETH', 'WETH', 18, wethContract);
    tokens = new TokenList([DAI, WETH].sort());

    const wstETHContract = await deploy('TestWstETH', { args: [WETH.address] });
    wstETH = new Token('wstETH', 'wstETH', 18, wstETHContract);

    relayer = await deploy('LidoBatchRelayer', { args: [vault.address, stakingContract.address, wstETH.address] });

    await tokens.mint({ to: sender, amount: fp(100) });
    await tokens.approve({ to: vault.address, amount: fp(100), from: sender });

    await WETH.mint(sender, fp(150));
    await WETH.approve(wstETHContract.address, fp(150), { from: sender });
    await wstETHContract.connect(sender).wrap(fp(150));
    await wstETHContract.connect(sender).approve(vault.address, fp(100));
    tokenIncrements = Array(tokens.length).fill(fp(1));
  });

  sharedBeforeEach('deploy sample pool', async () => {
    basePoolTokens = new TokenList([tokens.WETH, tokens.DAI].sort());
    basePool = await StablePool.create({ tokens: basePoolTokens, vault });
    basePoolId = basePool.poolId;

    // Approve vault to take LP's BPT
    const bptToken = new Token('BPT', 'BPT', 18, basePool.instance);
    await bptToken.approve(vault.address, fp(100), { from: sender });

    metaPoolTokens = new TokenList([wstETH, bptToken].sort());

    metaPool = await StablePool.create({ tokens: metaPoolTokens, vault });
    metaPoolId = metaPool.poolId;

    // Seed liquidity in pools

    await tokens.mint({ to: admin, amount: fp(200) });
    await tokens.approve({ to: vault.address, amount: MAX_UINT256, from: admin });
    await tokens.WETH.mint(admin, fp(150));
    await tokens.WETH.approve(wstETH.address, fp(150), { from: admin });
    await wstETH.instance.connect(admin).wrap(fp(150));

    await wstETH.approve(vault.address, MAX_UINT256, { from: admin });
    await bptToken.approve(vault.address, MAX_UINT256, { from: admin });

    await basePool.init({ initialBalances: fp(100), from: admin });
    await metaPool.init({ initialBalances: fp(100), from: admin });
  });
});
