import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import StablePool from '@balancer-labs/v2-helpers/src/models/pools/stable/StablePool';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ProtocolFee } from '@balancer-labs/v2-helpers/src/models/vault/types';

describe('ComposableStablePoolEdgeCase', () => {
  let lp: SignerWithAddress,
    owner: SignerWithAddress,
    recipient: SignerWithAddress,
    admin: SignerWithAddress,
    other: SignerWithAddress;

  const numberOfTokens = 2;
  const swapFeePercentage = fp(0.1); // 10 %
  const protocolFeePercentage = fp(0.5); // 50 %

  sharedBeforeEach('setup signers', async () => {
    [, lp, owner, recipient, admin, other] = await ethers.getSigners();
  });

  async function deployAndConfigPool() {
    const tokens = await TokenList.create(numberOfTokens, { sorted: true });
    const rateProvider: Contract = await deploy('v2-pool-utils/MockRateProvider');
    const exemptRateProvider: Contract = await deploy('v2-pool-utils/MockRateProvider');

    await exemptRateProvider.mockRate(fp(1.5));

    const pool = await StablePool.create({
      tokens: tokens,
      rateProviders: [exemptRateProvider, rateProvider],
      tokenRateCacheDurations: [1, 1],
      exemptFromYieldProtocolFeeFlags: [true, false],
      owner,
      admin,
      swapFeePercentage,
    });

    const feesCollector = await pool.vault.getFeesCollector();
    const feesProvider = pool.vault.getFeesProvider();
  
    await pool.vault.authorizer
      .connect(admin)
      .grantPermissions([actionId(feesProvider, 'setFeeTypePercentage')], admin.address, [feesProvider.address]);
  
    await pool.vault.authorizer
      .connect(admin)
      .grantPermissions(
        [actionId(feesCollector, 'setSwapFeePercentage'), actionId(feesCollector, 'setFlashLoanFeePercentage')],
        feesProvider.address,
        [feesCollector.address, feesCollector.address]
      );
  
    await feesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.SWAP, protocolFeePercentage);
    await feesProvider.connect(admin).setFeeTypePercentage(ProtocolFee.YIELD, protocolFeePercentage);

    await pool.updateProtocolFeePercentageCache();

    const initialBalances = Array.from({ length: numberOfTokens + 1 }).map((_, i) => (i == pool.bptIndex ? bn(0) : fp(100)))
    await pool.init({ from: lp, recipient: lp.address, initialBalances });

    await tokens.mint({ to: [lp, other], amount: fp(10000) });
    await tokens.approve({from: lp, to: pool.vault });
    await tokens.approve({from: other, to: pool.vault });

    //accrute protocol fee
    await pool.swapGivenIn({ in: tokens.tokens[0], out: tokens.tokens[1], amount: fp(50), from: lp, recipient: lp });
    await pool.swapGivenIn({ in: tokens.tokens[1], out: tokens.tokens[0], amount: fp(50), from: lp, recipient: lp });

    return { pool, tokens, rateProvider, exemptRateProvider, feesCollector };
  }


  it.only('A decrease in the rate provider rate should not result in a larger protocol fee being collected', async () => {
    const deployment1 = await deployAndConfigPool();
    const deployment2 = await deployAndConfigPool();

    //This is the only material difference between the two pool deployments, we downscale the exempt rate provider from 1.5 to 1.0    
    await deployment1.exemptRateProvider.mockRate(fp(1.0));

    const amountsIn1 = Array.from({ length: numberOfTokens + 1 }).map((_, i) => (i == deployment1.pool.bptIndex ? bn(0) : fp(0.0000000001)));
    await deployment1.pool.joinGivenIn({from: other, amountsIn: amountsIn1 });

    const amountsIn2 = Array.from({ length: numberOfTokens + 1 }).map((_, i) => (i == deployment2.pool.bptIndex ? bn(0) : fp(0.0000000001)));
    await deployment2.pool.joinGivenIn({from: other, amountsIn: amountsIn2 });


    const protocolBalance1 = await deployment1.pool.balanceOf(deployment1.feesCollector.address);
    const protocolBalance2 = await deployment2.pool.balanceOf(deployment2.feesCollector.address);

    console.log('protocolBalance1', protocolBalance1.toString());
    console.log('protocolBalance2', protocolBalance2.toString());

    expect(protocolBalance1).to.be.lte(protocolBalance2);
  });
});
