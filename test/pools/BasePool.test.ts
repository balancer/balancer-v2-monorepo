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

describe('BasePool', function () {
  let admin: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const MAX_SWAP_FEE = fp(0.15);
  const MIN_SWAP_FEE = fp(0.000001);

  before(async () => {
    [, admin, other] = await ethers.getSigners();
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
      emergencyResponseWindow?: number;
      emergencyBufferPeriod?: number;
    } = {}
  ): Promise<Contract> {
    let { tokens: poolTokens, swapFee, emergencyResponseWindow, emergencyBufferPeriod } = params;
    if (!poolTokens) poolTokens = tokens;
    if (!swapFee) swapFee = MIN_SWAP_FEE;
    if (!emergencyResponseWindow) emergencyResponseWindow = 0;
    if (!emergencyBufferPeriod) emergencyBufferPeriod = 0;

    return deploy('MockBasePool', {
      args: [
        vault.address,
        GeneralPool,
        'Balancer Pool Token',
        'BPT',
        Array.isArray(poolTokens) ? poolTokens : poolTokens.addresses,
        swapFee,
        emergencyResponseWindow,
        emergencyBufferPeriod,
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

      sharedBeforeEach('deploy pool', async () => {
        pool = await deployBasePool({ swapFee: fp(0.01) });
      });

      context('when the sender is has the role to do it', () => {
        let role: string;

        sharedBeforeEach('grant permission', async () => {
          role = roleId(pool, 'setSwapFee');
          await authorizer.connect(admin).grantRole(role, admin.address);
        });

        context('when the new swap fee is below the maximum', () => {
          it('can change the swap fee', async () => {
            expect(await authorizer.hasRole(role, admin.address)).to.be.true;

            const newSwapFee = fp(0.000001);
            await pool.connect(admin).setSwapFee(newSwapFee);

            expect(await pool.getSwapFee()).to.equal(newSwapFee);
          });

          it('emits an event', async () => {
            expect(await authorizer.hasRole(role, admin.address)).to.be.true;

            const newSwapFee = fp(0.000001);
            const receipt = await (await pool.connect(admin).setSwapFee(newSwapFee)).wait();

            expectEvent.inReceipt(receipt, 'SwapFeeChanged', { swapFee: newSwapFee });

            expect(await pool.getSwapFee()).to.equal(newSwapFee);
          });

          it('can change the swap fee to zero', async () => {
            expect(await authorizer.hasRole(role, admin.address)).to.be.true;

            const newSwapFee = fp(0.000001);
            await pool.connect(admin).setSwapFee(newSwapFee);

            expect(await pool.getSwapFee()).to.equal(newSwapFee);
          });

          it('can not change the swap fee if the role was revoked', async () => {
            await authorizer.connect(admin).revokeRole(role, admin.address);

            expect(await authorizer.hasRole(role, admin.address)).to.be.false;

            await expect(pool.connect(admin).setSwapFee(0)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });

        context('when the new swap fee is not below the maximum', () => {
          it('reverts', async () => {
            await expect(pool.connect(admin).setSwapFee(MAX_SWAP_FEE.add(1))).to.be.revertedWith('MAX_SWAP_FEE');
          });
        });

        context('when the new swap fee is not above the minimum', () => {
          it('reverts', async () => {
            await expect(pool.connect(admin).setSwapFee(MIN_SWAP_FEE.sub(1))).to.be.revertedWith('MIN_SWAP_FEE');
          });
        });
      });

      context('when the sender does not have the role to do it', () => {
        it('reverts', async () => {
          await expect(pool.connect(other).setSwapFee(MIN_SWAP_FEE)).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      });
    });
  });

  describe('emergency period', () => {
    let pool: Contract;
    const EMERGENCY_RESPONSE_WINDOW = MONTH * 3;
    const EMERGENCY_BUFFER_PERIOD = MONTH;

    sharedBeforeEach('deploy pool', async () => {
      pool = await deployBasePool({
        emergencyResponseWindow: EMERGENCY_RESPONSE_WINDOW,
        emergencyBufferPeriod: EMERGENCY_BUFFER_PERIOD,
      });
    });

    context('when the sender is has the role to do it', () => {
      let role: string;

      sharedBeforeEach('grant permission', async () => {
        role = roleId(pool, 'setPausedState');
        await authorizer.connect(admin).grantRole(role, admin.address);
      });

      it('can change the emergency period status', async () => {
        expect(await authorizer.hasRole(role, admin.address)).to.be.true;

        await pool.connect(admin).setPausedState(true);

        const { paused } = await pool.getPausedState();
        expect(paused).to.be.true;
      });

      it('can not change the emergency period if the role was revoked', async () => {
        await authorizer.connect(admin).revokeRole(role, admin.address);

        expect(await authorizer.hasRole(role, admin.address)).to.be.false;

        await expect(pool.connect(admin).setPausedState(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });

    context('when the sender does not have the role to do it', () => {
      it('reverts', async () => {
        await expect(pool.connect(other).setPausedState(true)).to.be.revertedWith('SENDER_NOT_ALLOWED');
      });
    });
  });
});
