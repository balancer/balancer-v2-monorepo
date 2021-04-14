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
  let admin: SignerWithAddress, poolOwner: SignerWithAddress, deployer: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList;

  const WHERE = ZERO_ADDRESS;

  const MIN_SWAP_FEE = fp(0.000001);
  const MAX_SWAP_FEE = fp(0.1);

  before(async () => {
    [, admin, poolOwner, deployer, other] = await ethers.getSigners();
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
      owner?: Account;
      from?: SignerWithAddress;
    } = {}
  ): Promise<Contract> {
    let { tokens: poolTokens, swapFee, emergencyPeriod, emergencyPeriodCheckExtension, owner } = params;
    if (!poolTokens) poolTokens = tokens;
    if (!swapFee) swapFee = MIN_SWAP_FEE;
    if (!emergencyPeriod) emergencyPeriod = 0;
    if (!emergencyPeriodCheckExtension) emergencyPeriodCheckExtension = 0;
    if (!owner) owner = ZERO_ADDRESS;

    return deploy('MockBasePool', {
      from: params.from,
      args: [
        vault.address,
        GeneralPool,
        'Balancer Pool Token',
        'BPT',
        Array.isArray(poolTokens) ? poolTokens : poolTokens.addresses,
        swapFee,
        emergencyPeriod,
        emergencyPeriodCheckExtension,
        TypesConverter.toAddress(owner),
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

    it('tracks authorizer changes in the vault', async () => {
      const role = await roleId(vault, 'changeAuthorizer');
      await authorizer.connect(admin).grantRole(role, admin.address);

      await vault.connect(admin).changeAuthorizer(other.address);

      expect(await pool.getAuthorizer()).to.equal(other.address);
    });

    describe('role identifiers', () => {
      const selector = '0x12345678';

      context('with same pool creator', () => {
        it('pools share role identifiers', async () => {
          const pool = await deployBasePool({ tokens, from: deployer });
          const otherPool = await deployBasePool({ tokens, from: deployer });

          expect(await pool.getRole(selector)).to.equal(await otherPool.getRole(selector));
        });
      });

      context('with different pool creators', () => {
        it('pools have unique role identifiers', async () => {
          const pool = await deployBasePool({ tokens, from: deployer });
          const otherPool = await deployBasePool({ tokens, from: other });

          expect(await pool.getRole(selector)).to.not.equal(await otherPool.getRole(selector));
        });
      });
    });
  });

  describe('swap fee', () => {
    context('initialization', () => {
      it('has an initial swap fee', async () => {
        const swapFee = fp(0.003);
        const pool = await deployBasePool({ swapFee });

        expect(await pool.getSwapFee()).to.equal(swapFee);
      });
    });

    context('set swap fee', () => {
      let pool: Contract;
      let sender: SignerWithAddress;

      function itSetsSwapFee() {
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
      }

      function itRevertsWithUnallowedSender() {
        it('reverts', async () => {
          await expect(pool.connect(sender).setSwapFee(MIN_SWAP_FEE)).to.be.revertedWith('SENDER_NOT_ALLOWED');
        });
      }

      context('with no owner', () => {
        const owner = ZERO_ADDRESS;

        sharedBeforeEach('deploy pool', async () => {
          pool = await deployBasePool({ swapFee: fp(0.01), owner });
        });

        context('when the sender has a set fee role in the authorizer', () => {
          sharedBeforeEach('grant permission', async () => {
            const role = await roleId(pool, 'setSwapFee');
            await authorizer.connect(admin).grantRole(role, admin.address);
            sender = admin;
          });

          itSetsSwapFee();
        });

        context('when the sender does not have the set fee role in the authorizer', () => {
          itRevertsWithUnallowedSender();
        });
      });

      context('with an owner', () => {
        let owner: SignerWithAddress;

        sharedBeforeEach('deploy pool', async () => {
          owner = poolOwner;
          pool = await deployBasePool({ swapFee: fp(0.01), owner });
        });

        context('when the sender is the owner', () => {
          beforeEach(() => {
            sender = owner;
          });

          itSetsSwapFee();
        });

        context('when the sender is not the owner', () => {
          beforeEach(() => {
            sender = other;
          });

          context('when the sender does not have the set fee role in the authorizer', () => {
            itRevertsWithUnallowedSender();
          });

          context('when the sender has the set fee role in the authorizer', () => {
            sharedBeforeEach(async () => {
              const role = await roleId(pool, 'setSwapFee');
              await authorizer.connect(admin).grantRole(role, sender.address);
            });

            itRevertsWithUnallowedSender();
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

    context('when the sender has the set emergency period role in the authorizer', () => {
      let role: string;

      sharedBeforeEach('grant permission', async () => {
        role = await roleId(pool, 'setEmergencyPeriod');
        await authorizer.connect(admin).grantRole(role, admin.address);
      });

      it('can change the emergency period status', async () => {
        expect(await authorizer.hasRoleIn(role, admin.address, WHERE)).to.be.true;

        await pool.connect(admin).setEmergencyPeriod(true);

        const { active } = await pool.getEmergencyPeriod();
        expect(active).to.be.true;
      });

      it('can not change the emergency period if the role is revoked', async () => {
        await authorizer.connect(admin).revokeRole(role, admin.address);

        expect(await authorizer.hasRoleIn(role, admin.address, WHERE)).to.be.false;

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
