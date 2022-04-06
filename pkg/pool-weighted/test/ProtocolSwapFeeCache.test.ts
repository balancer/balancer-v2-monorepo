import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { MAX_UINT256, ZERO_ADDRESS, ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';

describe('ProtocolSwapFeeCache', () => {
  const swapFeePercentage = fp(0.02);
  const protocolSwapFeePercentage = fp(0.1); // Fixed 10%
  const governanceProtocolFeePercentage = fp(0.5);
  const managementSwapFeePercentage = fp(0.5);
  const NUM_TOKENS = 4;

  let poolTokens: TokenList;
  let admin: SignerWithAddress, owner: SignerWithAddress, other: SignerWithAddress;
  let pool: WeightedPool;
  let authorizer: Contract;
  let authorizedVault: Contract;
  let protocolFeesCollector: Contract;

  const poolWeights: BigNumber[] = Array(NUM_TOKENS).fill(fp(1 / NUM_TOKENS));

  before('setup signers', async () => {
    [, admin, owner, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and tokens', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    authorizedVault = await deploy('v2-vault/Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });
    const feeCollector = await authorizedVault.getProtocolFeesCollector();
    protocolFeesCollector = await deployedAt('v2-vault/ProtocolFeesCollector', feeCollector);

    poolTokens = await TokenList.create(NUM_TOKENS, { sorted: true, varyDecimals: true });
    await poolTokens.mint({ to: [other], amount: fp(2000) });
  });

  context('non-delegated protocol fees', () => {
    sharedBeforeEach('deploy pool', async () => {
      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        swapFeePercentage,
        managementSwapFeePercentage,
        protocolSwapFeePercentage,
      };
      pool = await WeightedPool.create(params);
    });

    it('cannot update protocol fees when not delegated', async () => {
      await expect(pool.instance.updateCachedProtocolSwapFeePercentage()).to.be.revertedWith('UNAUTHORIZED_OPERATION');
    });

    it('reports the protocol swap fee', async () => {
      const feePercentage = await pool.instance.getCachedProtocolSwapFeePercentage();

      expect(feePercentage).to.equal(protocolSwapFeePercentage);
    });

    it('indicates no delegation', async () => {
      const delegatedFee = await pool.instance.getProtocolFeeDelegation();

      expect(delegatedFee).to.be.false;
    });
  });

  context('delegated protocol fees', () => {
    sharedBeforeEach('deploy pool and set protocol fee', async () => {
      const action = await actionId(protocolFeesCollector, 'setSwapFeePercentage');
      await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
      await protocolFeesCollector.connect(admin).setSwapFeePercentage(governanceProtocolFeePercentage);

      const params = {
        tokens: poolTokens,
        weights: poolWeights,
        owner: owner.address,
        poolType: WeightedPoolType.MANAGED_POOL,
        swapEnabledOnStart: true,
        vault: new Vault(false, authorizedVault, authorizer, admin),
        swapFeePercentage,
        managementSwapFeePercentage,
        protocolSwapFeePercentage: MAX_UINT256,
      };
      pool = await WeightedPool.create(params);
    });

    it('indicates delegation', async () => {
      const delegatedFee = await pool.instance.getProtocolFeeDelegation();

      expect(delegatedFee).to.be.true;
    });

    it('sets the protocol fee collector swap fee percentage', async () => {
      const swapFeePercentage = await protocolFeesCollector.getSwapFeePercentage();

      expect(swapFeePercentage).to.equal(governanceProtocolFeePercentage);
    });

    it('reports the delegated swap fee', async () => {
      const feePercentage = await pool.instance.getCachedProtocolSwapFeePercentage();

      expect(feePercentage).to.equal(governanceProtocolFeePercentage);
    });

    context('when governance updates the swap fee', () => {
      const NEW_GOVERNANCE_VALUE = fp(0.3);

      sharedBeforeEach('update the fee in the collector', async () => {
        await protocolFeesCollector.connect(admin).setSwapFeePercentage(NEW_GOVERNANCE_VALUE);
      });

      it('emits an event on update', async () => {
        const receipt = await (await pool.instance.updateCachedProtocolSwapFeePercentage()).wait();

        expectEvent.inReceipt(receipt, 'CachedProtocolSwapFeePercentageUpdated', {
          protocolSwapFeePercentage: NEW_GOVERNANCE_VALUE,
        });
      });

      it('updates pool cache', async () => {
        await pool.instance.updateCachedProtocolSwapFeePercentage();

        const feePercentage = await pool.instance.getCachedProtocolSwapFeePercentage();

        expect(feePercentage).to.equal(NEW_GOVERNANCE_VALUE);
      });
    });
  });
});
