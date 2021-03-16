import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '../tokens/Token';
import VaultDeployer from './VaultDeployer';
import TypesConverter from '../types/TypesConverter';
import { roleId } from '../../../../lib/helpers/roles';
import { MAX_UINT256 } from '../../../../lib/helpers/constants';
import { Account } from '../types/types';
import { ExitPool, JoinPool, RawVaultDeployment } from './types';

export default class Vault {
  mocked: boolean;
  instance: Contract;
  authorizer?: Contract;
  admin?: SignerWithAddress;

  static async create(deployment: RawVaultDeployment = {}): Promise<Vault> {
    return VaultDeployer.deploy(deployment);
  }

  constructor(mocked: boolean, instance: Contract, authorizer?: Contract, admin?: SignerWithAddress) {
    this.mocked = mocked;
    this.instance = instance;
    this.authorizer = authorizer;
    this.admin = admin;
  }

  get address(): string {
    return this.instance.address;
  }

  async getPool(poolId: string): Promise<{ address: string; specialization: BigNumber }> {
    const [address, specialization] = await this.instance.getPool(poolId);
    return { address, specialization };
  }

  async getPoolTokens(poolId: string): Promise<{ tokens: string[]; balances: BigNumber[] }> {
    return this.instance.getPoolTokens(poolId);
  }

  async getPoolTokenInfo(
    poolId: string,
    token: Token
  ): Promise<{ cash: BigNumber; managed: BigNumber; blockNumber: BigNumber; assetManager: string }> {
    return this.instance.getPoolTokenInfo(poolId, token.address);
  }

  async joinPool(params: JoinPool): Promise<ContractTransaction> {
    const vault = params.from ? this.instance.connect(params.from) : this.instance;
    return this.mocked
      ? vault.callJoinPool(
          params.poolAddress,
          params.poolId,
          params.recipient,
          params.currentBalances,
          params.latestBlockNumberUsed,
          params.protocolFeePercentage,
          params.data
        )
      : vault.joinPool(
          params.poolId,
          (params.from || (await this._defaultSender())).address,
          params.recipient,
          params.tokens,
          params.maxAmountsIn ?? Array(params.tokens.length).fill(MAX_UINT256),
          params.fromInternalBalance ?? false,
          params.data
        );
  }

  async exitPool(params: ExitPool): Promise<ContractTransaction> {
    const vault = params.from ? this.instance.connect(params.from) : this.instance;
    return this.mocked
      ? vault.callExitPool(
          params.poolAddress,
          params.poolId,
          params.recipient,
          params.currentBalances,
          params.latestBlockNumberUsed,
          params.protocolFeePercentage,
          params.data
        )
      : vault.exitPool(
          params.poolId,
          (params.from || (await this._defaultSender())).address,
          params.recipient,
          params.tokens,
          params.minAmountsOut ?? Array(params.tokens.length).fill(0),
          params.toInternalBalance ?? false,
          params.data
        );
  }

  async getProtocolFees(): Promise<{ swapFee: BigNumber; withdrawFee: BigNumber; flashLoanFee: BigNumber }> {
    return this.instance.getProtocolFees();
  }

  async setWithdrawFee(withdrawFee: BigNumber): Promise<ContractTransaction> {
    if (this.authorizer && this.admin) {
      const admin = (await ethers.getSigners())[0];
      const role = roleId(this.instance, 'setProtocolFees');
      await this.authorizer.grantRole(role, admin.address);
    }

    const { swapFee, flashLoanFee } = await this.getProtocolFees();
    const instance = this.admin ? this.instance.connect(this.admin) : this.instance;
    return instance.setProtocolFees(swapFee, withdrawFee, flashLoanFee);
  }

  async grantRole(roleId: string, to?: Account): Promise<ContractTransaction> {
    if (!this.authorizer || !this.admin) throw Error("Missing Vault's authorizer or admin instance");
    if (!to) to = await this._defaultSender();
    return this.authorizer.connect(this.admin).grantRole(roleId, TypesConverter.toAddress(to));
  }

  async _defaultSender(): Promise<SignerWithAddress> {
    const signers = await ethers.getSigners();
    return signers[0];
  }
}
