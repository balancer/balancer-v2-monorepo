import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../helpers/expectEvent';
import TokenList from '../helpers/models/tokens/TokenList';
import { MONTH } from '../../lib/helpers/time';
import { roleId } from '../../lib/helpers/roles';
import { deploy } from '../../lib/helpers/deploy';
import { GeneralPool } from '../../lib/helpers/pools';
import { BigNumberish, fp } from '../../lib/helpers/numbers';
import { ZERO_ADDRESS } from '../../lib/helpers/constants';
import { Account } from '../helpers/models/types/types';
import TypesConverter from '../helpers/models/types/TypesConverter';

describe('BasePool', function () {
  let admin: SignerWithAddress, poolFeeSetter: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const MAX_SWAP_FEE = fp(0.1);
  const MIN_SWAP_FEE = fp(0.000001);

  before(async () => {
    [, admin, poolFeeSetter, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
  });

  function deployBasePool(
    params: {
      tokens?: TokenList | string[];
      swapFee?: BigNumberish;
      emergencyPeriod?: number;
      emergencyPeriodCheckExtension?: number;
      feeSetter?: Account;
    } = {}
  ): Promise<Contract> {
    let { tokens: poolTokens, swapFee, emergencyPeriod, emergencyPeriodCheckExtension, feeSetter } = params;
    if (!poolTokens) poolTokens = tokens;
    if (!swapFee) swapFee = MIN_SWAP_FEE;
    if (!emergencyPeriod) emergencyPeriod = 0;
    if (!emergencyPeriodCheckExtension) emergencyPeriodCheckExtension = 0;
    if (!feeSetter) feeSetter = ZERO_ADDRESS;

    return deploy('MockBasePool', {
      args: [
        vault.address,
        GeneralPool,
        'Balancer Pool Token',
        'BPT',
        Array.isArray(poolTokens) ? poolTokens : poolTokens.addresses,
        swapFee,
        emergencyPeriod,
        emergencyPeriodCheckExtension,
        TypesConverter.toAddress(feeSetter),
      ],
    });
  }

  describe('deployment', () => {
    it('registers a pool in the vault', async () => {
      const pool = await deployBasePool({ tokens });
      const poolId = await pool.getPoolId();

      const [poolAddress, poolSpecialization] = await vault.getPool(poolId);
      expect(poolAddress).to.equal(pool.address);
      expect(poolSpecialization).to.equal(GeneralPool);
    });

    it('reverts if the tokens are not sorted', async () => {
      await expect(deployBasePool({ tokens: tokens.addresses.reverse() })).to.be.revertedWith('UNSORTED_ARRAY');
    });
  });

  describe('authorizer', () => {
    let pool: Contract;

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployBasePool();
    });

    it('uses the authorizer of the vault', async () => {
      expect(await pool.getAuthorizer()).to.equal(authorizer.address);
    });

    it('does not affect if the vault changes the authorizer', async () => {
      const role = roleId(vault, 'changeAuthorizer');
      await authorizer.connect(admin).grantRole(role, admin.address);

      await vault.connect(admin).changeAuthorizer(other.address);

      expect(await pool.getAuthorizer()).to.equal(other.address);
    });
  });

  describe('swap fee', () => {
    context('initialization', () => {
      it('has an initial swap fee', async () => {
        const swapFee = fp(0.003);
        const pool = await deployBasePool({ swapFee });

        expect(await pool.getSwapFee()).to.equal(swapFee);
      });

      it('can be initialized to the zero address', async () => {
        const swapFee = MIN_SWAP_FEE;
        const pool = await deployBasePool({ swapFee });

        expect(await pool.getSwapFee()).to.equal(swapFee);
      });
    });

    context('setting the swap fee', () => {
      let pool: Contract;

      context('with no fee setter', () => {
        const feeSetter = ZERO_ADDRESS;

        sharedBeforeEach('deploy pool', async () => {
          pool = await deployBasePool({ swapFee: fp(0.01), feeSetter });
        });

        context('when the sender has a set fee role in the authorizer', () => {
          let sender: SignerWithAddress;

          sharedBeforeEach('grant permission', async () => {
            const role = roleId(pool, 'setSwapFee');
            await authorizer.connect(admin).grantRole(role, admin.address);
            sender = admin;
          });

          context('when the new swap fee is within bounds', () => {
            const newSwapFee = MAX_SWAP_FEE.sub(1);

            it('can change the swap fee', async () => {
              await pool.connect(sender).setSwapFee(newSwapFee);

              expect(await pool.getSwapFee()).to.equal(newSwapFee);
            });

            it('emits an event', async () => {
              const receipt = await (await pool.connect(sender).setSwapFee(newSwapFee)).wait();

              expectEvent.inReceipt(receipt, 'SwapFeeChanged', { swapFee: newSwapFee });
            });
          });

          context('when the new swap fee is above the maximum', () => {
            const swapFee = MAX_SWAP_FEE.add(1);

            it('reverts', async () => {
              await expect(pool.connect(sender).setSwapFee(swapFee)).to.be.revertedWith('MAX_SWAP_FEE');
            });
          });

          context('when the new swap fee is below the minimum', () => {
            const swapFee = MIN_SWAP_FEE.sub(1);

            it('reverts', async () => {
              await expect(pool.connect(sender).setSwapFee(swapFee)).to.be.revertedWith('MIN_SWAP_FEE');
            });
          });
        });

        context('when the sender does not have the set fee role in the authorizer', () => {
          it('reverts', async () => {
            await expect(pool.connect(other).setSwapFee(MIN_SWAP_FEE)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });

      context('with a fee setter', () => {
        let feeSetter: SignerWithAddress;

        sharedBeforeEach('deploy pool', async () => {
          feeSetter = poolFeeSetter;
          pool = await deployBasePool({ swapFee: fp(0.01), feeSetter });
        });

        context('when the sender is the fee setter', () => {
          context('when the new swap fee is within bounds', () => {
            const newSwapFee = MAX_SWAP_FEE.sub(1);

            it('can change the swap fee', async () => {
              await pool.connect(feeSetter).setSwapFee(newSwapFee);

              expect(await pool.getSwapFee()).to.equal(newSwapFee);
            });

            it('emits an event', async () => {
              const receipt = await (await pool.connect(feeSetter).setSwapFee(newSwapFee)).wait();

              expectEvent.inReceipt(receipt, 'SwapFeeChanged', { swapFee: newSwapFee });
            });
          });

          context('when the new swap fee is above the maximum', () => {
            const swapFee = MAX_SWAP_FEE.add(1);

            it('reverts', async () => {
              await expect(pool.connect(feeSetter).setSwapFee(swapFee)).to.be.revertedWith('MAX_SWAP_FEE');
            });
          });

          context('when the new swap fee is below the minimum', () => {
            const swapFee = MIN_SWAP_FEE.sub(1);

            it('reverts', async () => {
              await expect(pool.connect(feeSetter).setSwapFee(swapFee)).to.be.revertedWith('MIN_SWAP_FEE');
            });
          });
        });

        context('when the sender is not the fee setter', () => {
          context('when the sender does not have the role in the authorizer', () => {
            it('reverts', async () => {
              await expect(pool.connect(other).setSwapFee(MIN_SWAP_FEE)).to.be.revertedWith('SENDER_NOT_ALLOWED');
            });
          });

          context('when the sender has the role in the authorizer', () => {
            sharedBeforeEach(async () => {
              const role = roleId(pool, 'setSwapFee');
              await authorizer.connect(admin).grantRole(role, other.address);
            });

            it('reverts', async () => {
              await expect(pool.connect(other).setSwapFee(MIN_SWAP_FEE)).to.be.revertedWith('SENDER_NOT_ALLOWED');
            });
          });
        });
      });
    });
  });

  describe('emergency period', () => {
    let pool: Contract;
    const EMERGENCY_PERIOD = MONTH * 3;
    const EMERGENCY_PERIOD_CHECK_EXTENSION = MONTH;

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployBasePool({
        emergencyPeriod: EMERGENCY_PERIOD,
        emergencyPeriodCheckExtension: EMERGENCY_PERIOD_CHECK_EXTENSION,
      });
    });

    context('when the sender is has the role to do it', () => {
      let role: string;

      sharedBeforeEach('grant permission', async () => {
        role = roleId(pool, 'setEmergencyPeriod');
        await authorizer.connect(admin).grantRole(role, admin.address);
      });

      it('can change the emergency period status', async () => {
        expect(await authorizer.hasRole(role, admin.address)).to.be.true;

        await pool.connect(admin).setEmergencyPeriod(true);

        const { active } = await pool.getEmergencyPeriod();
        expect(active).to.be.true;
      });

      it('can not change the emergency period if the role was revoked', async () => {
        await authorizer.connect(admin).revokeRole(role, admin.address);

        expect(await authorizer.hasRole(role, admin.address)).to.be.false;

        await expect(pool.connect(admin).setEmergencyPeriod(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the set emergency period role in the authorizer', () => {
      it('reverts', async () => {
        await expect(pool.connect(other).setEmergencyPeriod(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
