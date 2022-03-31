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
  let admin: SignerWithAddress, creator: SignerWithAddress, recipient: SignerWithAddress;
  let authorizer: Contract, vault: Contract, feesCollector: Contract;
  let allTokens: TokenList;

  const AUM_FEE_PERCENTAGE = fp(0.1);

  before(async () => {
    [, admin, creator, recipient] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    const WETH = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('v2-vault/TimelockAuthorizer', { args: [admin.address, ZERO_ADDRESS] });
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

    it('sets the authorizer', async () => {
      const authorizer = await feesCollector.getAuthorizer();

      expect(authorizer).to.equal(await vault.getAuthorizer());
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

  context('fee collection', () => {
    const FEE_AMOUNTS = [fp(10), fp(20), fp(30), fp(50)];
    const COLLECTED_AMOUNTS = [fp(10), fp(15), fp(5), fp(40)];

    sharedBeforeEach('simulate fee collection', async () => {
      allTokens.DAI.transfer(feesCollector.address, FEE_AMOUNTS[0], { from: creator });
      allTokens.MKR.transfer(feesCollector.address, FEE_AMOUNTS[1], { from: creator });
      allTokens.SNX.transfer(feesCollector.address, FEE_AMOUNTS[2], { from: creator });
      allTokens.BAT.transfer(feesCollector.address, FEE_AMOUNTS[3], { from: creator });

      const action = await actionId(feesCollector, 'withdrawCollectedFees');
      await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
    });

    it('reports the collected fees', async () => {
      const collectedFeeAmounts = await feesCollector.getCollectedFeeAmounts(allTokens.addresses);

      expect(collectedFeeAmounts).to.deep.equal(FEE_AMOUNTS);
    });

    it('non-admins cannot collect fees', async () => {
      await expect(
        feesCollector.withdrawCollectedFees(allTokens.addresses, FEE_AMOUNTS, recipient.address)
      ).to.be.revertedWith('SENDER_NOT_ALLOWED');
    });

    it('fee collection reverts with mismatched arguments', async () => {
      await expect(
        feesCollector.connect(admin).withdrawCollectedFees(allTokens.addresses, [fp(10), fp(10)], recipient.address)
      ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });

    it('cannot withdraw amounts higher than those collected', async () => {
      await expect(
        feesCollector.connect(admin).withdrawCollectedFees(
          allTokens.addresses,
          FEE_AMOUNTS.map((amount) => amount.add(1)),
          recipient.address
        )
      ).to.be.revertedWith('ERC20_TRANSFER_EXCEEDS_BALANCE');
    });

    it('collects fees', async () => {
      await feesCollector
        .connect(admin)
        .withdrawCollectedFees(allTokens.addresses, COLLECTED_AMOUNTS, recipient.address);

      expect(await allTokens.DAI.balanceOf(recipient.address)).to.equal(COLLECTED_AMOUNTS[0]);
      expect(await allTokens.MKR.balanceOf(recipient.address)).to.equal(COLLECTED_AMOUNTS[1]);
      expect(await allTokens.SNX.balanceOf(recipient.address)).to.equal(COLLECTED_AMOUNTS[2]);
      expect(await allTokens.BAT.balanceOf(recipient.address)).to.equal(COLLECTED_AMOUNTS[3]);
    });
  });
});
