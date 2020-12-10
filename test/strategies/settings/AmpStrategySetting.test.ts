import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';
import * as expectEvent from '../../helpers/expectEvent';

describe('AmpStrategySetting', function () {
  let strategy: Contract;

  const AMP = (7.6e18).toString();

  const deployStrategy = (isMutable: boolean) => {
    beforeEach('deploy strategy', async function () {
      const AmpStrategySetting: ContractFactory = await ethers.getContractFactory('MockAmpStrategySetting');
      strategy = await AmpStrategySetting.deploy([isMutable, AMP]);
      await strategy.deployed();
    });
  };

  const itInitializesTheSettingCorrectly = () => {
    describe('initialization', () => {
      it('initializes the setting correctly', async () => {
        const currentAmp = await strategy.getAmp();
        expect(currentAmp).to.equal(AMP);
      });
    });
  };

  context('when the setting is mutable', () => {
    const mutable = true;

    deployStrategy(mutable);

    itInitializesTheSettingCorrectly();

    it('supports changing its value', async () => {
      const newAmp = (5.5e18).toString();

      const receipt = await (await strategy.mockSetAmp(newAmp)).wait();
      expectEvent.inReceipt(receipt, 'AmpSet', { amp: newAmp });

      const currentAmp = await strategy.getAmp();
      expect(currentAmp).to.equal(newAmp);
    });
  });

  context('when the setting is immutable', () => {
    const mutable = false;

    deployStrategy(mutable);

    itInitializesTheSettingCorrectly();

    it('does not support changing its value', async () => {
      const newAmp = (5.5e18).toString();
      await expect(strategy.mockSetAmp(newAmp)).to.be.revertedWith('AMP_NOT_MUTABLE');
    });
  });
});
