import { ethers } from 'hardhat';
import { expect } from 'chai';
import { ContractFactory, Contract } from 'ethers';
import * as expectEvent from '../../helpers/expectEvent';

describe('WeightsStrategySetting', function () {
  let strategy: Contract;

  const generateSettingsParams = (num: number): [string[], string[]] => {
    const tokens: string[] = [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '0x0000000000000000000000000000000000000003',
      '0x0000000000000000000000000000000000000004',
      '0x0000000000000000000000000000000000000005',
      '0x0000000000000000000000000000000000000006',
      '0x0000000000000000000000000000000000000007',
      '0x0000000000000000000000000000000000000008',
      '0x0000000000000000000000000000000000000009',
      '0x0000000000000000000000000000000000000010',
      '0x0000000000000000000000000000000000000011',
      '0x0000000000000000000000000000000000000012',
      '0x0000000000000000000000000000000000000013',
      '0x0000000000000000000000000000000000000014',
      '0x0000000000000000000000000000000000000015',
      '0x0000000000000000000000000000000000000016',
      '0x0000000000000000000000000000000000000017',
    ].slice(0, num);
    const weights = tokens.map((x) => (parseInt(x) * 1e18).toString());
    return [tokens, weights];
  };

  const deploySetting = async (isMutable: boolean, tokens: string[], weights: string[]) => {
    const WeightsStrategySetting: ContractFactory = await ethers.getContractFactory('WeightsStrategySetting');
    strategy = await WeightsStrategySetting.deploy([isMutable, tokens, weights]);
    await strategy.deployed();
  };

  describe('initialization', () => {
    const itInitializesTheSettingCorrectly = (mutable: boolean) => {
      for (let total = 2; total <= 16; total++) {
        const [tokens, weights] = generateSettingsParams(total);

        it(`initializes the setting correctly for ${total} tokens`, async () => {
          await deploySetting(mutable, tokens, weights);

          expect(await strategy.getTotalTokens()).to.equal(tokens.length);

          for (const token of tokens) {
            const weight = await strategy.getWeight(token);
            expect(weight).to.equal(weights[tokens.indexOf(token)]);
          }

          const invalidToken = '0x00000000000000000000000000000000000000aa';
          await expect(strategy.getWeight(invalidToken)).to.be.revertedWith('ERR_INVALID_TOKEN');
        });
      }

      it('cannot initialize without tokens', async () => {
        await expect(deploySetting(mutable, [], [])).to.be.revertedWith('ERR_MIN_TOKENS');
      });

      it('cannot initialize with 1 token', async () => {
        const [tokens, weights] = generateSettingsParams(1);
        await expect(deploySetting(mutable, tokens, weights)).to.be.revertedWith('ERR_MIN_TOKENS');
      });

      it('cannot initialize with more than 16 tokens', async () => {
        const [tokens, weights] = generateSettingsParams(17);
        await expect(deploySetting(mutable, tokens, weights)).to.be.revertedWith('ERR_MAX_TOKENS');
      });

      it('cannot initialize with different tokens and weights length', async () => {
        const [tokens] = generateSettingsParams(2);
        await expect(deploySetting(mutable, tokens, ['1'])).to.be.revertedWith('ERR_WEIGHTS_LIST');
      });

      it('cannot initialize with an invalid address', async () => {
        const tokens = ['0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000'];
        await expect(deploySetting(mutable, tokens, ['1', '2'])).to.be.revertedWith('ERR_INVALID_ADDRESS');
      });

      it('cannot initialize with zeroed weights', async () => {
        const [tokens] = generateSettingsParams(2);
        await expect(deploySetting(mutable, tokens, ['0', '0'])).to.be.revertedWith('ERR_MIN_WEIGHT');
      });
    };

    context('when the setting is immutable', () => {
      const mutable = false;

      itInitializesTheSettingCorrectly(mutable);
    });

    context('when the setting is mutable', () => {
      const mutable = true;

      itInitializesTheSettingCorrectly(mutable);
    });
  });

  describe('set weights', () => {
    const [tokens, weights] = generateSettingsParams(2);

    context('when the setting is immutable', () => {
      const mutable = false;

      beforeEach('deploy setting', async () => {
        await deploySetting(mutable, tokens, weights);
      });

      const itCannotChangeWeights = (newWeights: string[]) => {
        it('does not support changing weights', async () => {
          await expect(strategy.setWeights(newWeights)).to.be.revertedWith('Token weights are not mutable');
        });
      };

      context('when trying to change a smaller number of weights', () => {
        const newWeights = ['1'];
        itCannotChangeWeights(newWeights);
      });

      context('when trying to change the same number of weights', () => {
        const newWeights = ['1', '2'];
        itCannotChangeWeights(newWeights);
      });

      context('when trying to change a greater number of weights', () => {
        const newWeights = ['2', '1', '3'];
        itCannotChangeWeights(newWeights);
      });
    });

    context('when the setting is mutable', () => {
      const mutable = true;

      beforeEach('deploy setting', async () => {
        await deploySetting(mutable, tokens, weights);
      });

      context('when trying to change a smaller number of weights', () => {
        const newWeights = ['1'];

        it('does not support changing weights', async () => {
          await expect(strategy.setWeights(newWeights)).to.be.revertedWith('ERR_WEIGHTS_LIST');
        });
      });

      context('when trying to change the same number of weights', () => {
        const newWeights = ['3', '5'];

        it('supports changing the weights', async () => {
          const receipt = await (await strategy.setWeights(newWeights)).wait();
          expectEvent.inReceipt(receipt, 'WeightsSet');

          expect(await strategy.getWeight(tokens[0])).to.equal(newWeights[0]);
          expect(await strategy.getWeight(tokens[1])).to.equal(newWeights[1]);
        });
      });

      context('when trying to change a greater number of weights', () => {
        const newWeights = ['2', '1', '3'];

        it('does not support changing weights', async () => {
          await expect(strategy.setWeights(newWeights)).to.be.revertedWith('ERR_WEIGHTS_LIST');
        });
      });
    });
  });
});
