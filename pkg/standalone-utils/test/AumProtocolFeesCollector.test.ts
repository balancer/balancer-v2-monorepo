import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ANY_ADDRESS, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

describe('AUM Protocol Fees Collector', function () {
  let admin: SignerWithAddress, creator: SignerWithAddress;
  let authorizer: Contract, vault: Contract, feesCollector: Contract;
  let allTokens: TokenList;

  const AUM_FEE_PERCENTAGE = fp(0.1);

  before(async () => {
    [, admin, creator] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS, MONTH] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, WETH.address, MONTH, MONTH] });
    feesCollector = await deploy('AumProtocolFeesCollector', { args: [vault.address] });

    const action = await actionId(feesCollector, 'setAumFeePercentage');
    await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
    await feesCollector.connect(admin).setAumFeePercentage(AUM_FEE_PERCENTAGE);

    allTokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'], { sorted: true });
    await allTokens.mint({ to: [creator], amount: bn(100e18) });
    await allTokens.approve({ to: vault, from: [creator] });
  });

  context('initialization', () => {
    it('sets the AUM fee percentage', async () => {
      const aumFee = await feesCollector.getAumFeePercentage();
      expect(aumFee).to.equal(AUM_FEE_PERCENTAGE);
    });
  });

  context('setting aum fees', () => {
    it('cannot set aum fee higher than max', async () => {
      await expect(feesCollector.connect(admin).setAumFeePercentage(fp(0.3))).to.be.revertedWith(
        'AUM_FEE_PERCENTAGE_TOO_HIGH'
      );
    });

    it('non-admins cannot set the aum fee', async () => {
      expect(feesCollector.setAumFeePercentage(fp(0.05))).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });
  });
});
