import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { deployTokens, TokenList } from '../../lib/helpers/tokens';
import { MAX_UINT128, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { GeneralPool } from '../../lib/helpers/pools';

describe.only('Vault - swap validation', () => {
  let vault: Contract;
  let tokens: TokenList, tokenAddresses: string[];
  let lp: SignerWithAddress, trader: SignerWithAddress;

  beforeEach('setup', async () => {
    [, lp, trader] = await ethers.getSigners();

    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];

    for (const symbol in tokens) {
      // lp tokens are used to seed pools
      await tokens[symbol].mint(lp.address, MAX_UINT128.div(2));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT128);

      await tokens[symbol].mint(trader.address, MAX_UINT128.div(2));
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT128);
    }

    // The Pool specialization setting does not affect validation
    const pool = await deploy('MockPool', { args: [vault.address, GeneralPool] });
    const poolId = await pool.getPoolId();

    await vault.connect(lp).joinPool(poolId);
  });

  context('in swaps given in', () => {
    itValidatesCorrectly();
  });

  context('in swaps given out', () => {});

  function itValidatesCorrectly() {
    context('with expired deadline', () => {
      it('reverts', async () => {});
    });

    context('with unexpired deadline', () => {
      it('reverts if there are less limits than tokens', async () => {});

      it('reverts if there are more limits than tokens', async () => {});

      context('with limits too low', () => {
        it('passes', async () => {});
      });

      context('with exact limits', () => {
        it('passes', async () => {});
      });

      context('with sufficient limits', () => {
        context('withdrawing from internal balance', () => {
          context('depositing to internal balance', () => {
            it('passes the validation', async () => {});
          });
        });
      });
    });
  }
});
