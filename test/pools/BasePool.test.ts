import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '../helpers/models/tokens/TokenList';
import { MONTH } from '../../lib/helpers/time';
import { deploy } from '../../lib/helpers/deploy';
import { GeneralPool } from '../../lib/helpers/pools';
import { BigNumberish, fp } from '../../lib/helpers/numbers';

describe('BasePool', function () {
  let admin: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  before(async () => {
    [, admin, other] = await ethers.getSigners();
  });

  sharedBeforeEach(async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, 0, 0] });
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
  });

  function deployBasePool(params: {
    tokens?: TokenList | string[];
    swapFee?: BigNumberish;
    emergencyPeriod?: number;
    emergencyPeriodCheckExtension?: number;
  }): Promise<Contract> {
    let { tokens: poolTokens, swapFee, emergencyPeriod, emergencyPeriodCheckExtension } = params;
    if (!poolTokens) poolTokens = tokens;
    if (!swapFee) swapFee = 0;
    if (!emergencyPeriod) emergencyPeriod = 0;
    if (!emergencyPeriodCheckExtension) emergencyPeriodCheckExtension = 0;

    return deploy('MockBasePool', {
      args: [
        authorizer.address,
        vault.address,
        GeneralPool,
        'Balancer Pool Token',
        'BPT',
        Array.isArray(poolTokens) ? poolTokens : poolTokens.addresses,
        swapFee,
        emergencyPeriod,
        emergencyPeriodCheckExtension,
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

  describe('swap fee', () => {
    it('has an initial swap fee', async () => {
      const swapFee = fp(0.003);
      const pool = await deployBasePool({ swapFee });

      expect(await pool.getSwapFee()).to.equal(swapFee);
    });

    it('can be initialized to the zero address', async () => {
      const swapFee = 0;
      const pool = await deployBasePool({ swapFee });

      expect(await pool.getSwapFee()).to.equal(swapFee);
    });
  });

  describe('set swap fee', () => {
    let pool: Contract;

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployBasePool({ swapFee: fp(0.01) });
    });

    context('when the sender is has the role to do it', () => {
      let roleId: string;

      sharedBeforeEach('grant permission', async () => {
        roleId = await pool.CHANGE_POOL_SWAP_FEE_ROLE();
        await authorizer.connect(admin).grantRole(roleId, admin.address);
      });

      context('when the new swap fee is below the maximum', () => {
        it('can change the swap fee', async () => {
          expect(await pool.canChangeSwapFee(admin.address)).to.be.true;

          const newSwapFee = fp(0.000001);
          await pool.connect(admin).setSwapFee(newSwapFee);

          expect(await pool.getSwapFee()).to.equal(newSwapFee);
        });

        it('can change the swap fee to zero', async () => {
          expect(await pool.canChangeSwapFee(admin.address)).to.be.true;

          const newSwapFee = fp(0.000001);
          await pool.connect(admin).setSwapFee(newSwapFee);

          expect(await pool.getSwapFee()).to.equal(newSwapFee);
        });

        it('can not change the swap fee if the role was revoked', async () => {
          await authorizer.connect(admin).revokeRole(roleId, admin.address);

          expect(await pool.canChangeSwapFee(admin.address)).to.be.false;

          await expect(pool.connect(admin).setSwapFee(0)).to.be.revertedWith('SENDER_CANNOT_CHANGE_SWAP_FEE');
        });
      });

      context('when the new swap fee is not below the maximum', () => {
        const MAX_SWAP_FEE = fp(0.1);

        it('reverts', async () => {
          await expect(pool.connect(admin).setSwapFee(MAX_SWAP_FEE.add(1))).to.be.revertedWith('MAX_SWAP_FEE');
        });
      });
    });

    context('when the sender does not have the role to do it', () => {
      it('reverts', async () => {
        await expect(pool.connect(other).setSwapFee(0)).to.be.revertedWith('SENDER_CANNOT_CHANGE_SWAP_FEE');
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
      let roleId: string;

      sharedBeforeEach('grant permission', async () => {
        roleId = await pool.CHANGE_POOL_EMERGENCY_PERIOD_ROLE();
        await authorizer.connect(admin).grantRole(roleId, admin.address);
      });

      it('can change the emergency period status', async () => {
        expect(await pool.canChangeEmergencyPeriod(admin.address)).to.be.true;

        await pool.connect(admin).setEmergencyPeriod(true);

        const { active } = await pool.getEmergencyPeriod();
        expect(active).to.be.true;
      });

      it('can not change the emergency period if the role was revoked', async () => {
        await authorizer.connect(admin).revokeRole(roleId, admin.address);

        expect(await pool.canChangeEmergencyPeriod(admin.address)).to.be.false;

        await expect(pool.connect(admin).setEmergencyPeriod(true)).to.be.revertedWith('CANNOT_CHANGE_EMERGENCY_PER');
      });
    });

    context('when the sender does not have the role to do it', () => {
      it('reverts', async () => {
        await expect(pool.connect(other).setEmergencyPeriod(true)).to.be.revertedWith('CANNOT_CHANGE_EMERGENCY_PER');
      });
    });
  });
});
