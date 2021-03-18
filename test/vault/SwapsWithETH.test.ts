import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { Dictionary } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '../helpers/models/tokens/TokenList';
import { roleId } from '../../lib/helpers/roles';
import { encodeJoin } from '../helpers/mockPool';
import { Comparison, expectBalanceChange } from '../helpers/tokenBalance';

import { deploy } from '../../lib/helpers/deploy';
import { BigNumberish, fp, bn } from '../../lib/helpers/numbers';
import { FundManagement, Swap, toSwapIn, toSwapOut } from '../../lib/helpers/trading';
import { MAX_INT256, MAX_UINT112, MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '../../lib/helpers/constants';
import { MinimalSwapInfoPool, PoolSpecializationSetting, GeneralPool, TwoTokenPool } from '../../lib/helpers/pools';
import TokensDeployer from '../helpers/models/tokens/TokensDeployer';

describe('Vault - swaps', () => {
  let vault: Contract, authorizer: Contract, funds: FundManagement;
  let tokens: TokenList;
  let lp: SignerWithAddress, trader: SignerWithAddress, other: SignerWithAddress, admin: SignerWithAddress;

  before('setup', async () => {
    [, lp, trader, other, admin] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and tokens', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, WETH.address, 0, 0] });

    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: MAX_UINT112.div(2) });
    await tokens.approve({ to: vault, from: [lp, trader], amount: MAX_UINT112 });
  });

  beforeEach('set up default sender', async () => {
    funds = {
      sender: trader.address,
      recipient: trader.address,
      fromInternalBalance: false,
      toInternalBalance: false,
    };
  });

  it('receives eth as weth');
  it('sends weth as eth');
  it('stores weth in the event');
  it('returns excess eth to the relayer');
  it('reverts if eth was sent but not used');
  it('reverts if not enough eth was supplied');
});
