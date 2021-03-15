import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '../tokens/Token';
import VaultDeployer from './VaultDeployer';
import TypesConverter from '../types/TypesConverter';
import { Account } from '../types/types';
import { JoinExitPool, RawVaultDeployment } from './types';

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

  async joinPool(params: JoinExitPool): Promise<ContractTransaction> {
    const vault = params.from ? this.instance.connect(params.from) : this.instance;
    return vault.callJoinPool(
      params.poolAddress,
      params.poolId,
      params.recipient,
      params.currentBalances,
      params.latestBlockNumberUsed,
      params.protocolFeePercentage,
      params.data
    );
  }

  async exitPool(params: JoinExitPool): Promise<ContractTransaction> {
    const vault = params.from ? this.instance.connect(params.from) : this.instance;
    return vault.callExitPool(
      params.poolAddress,
      params.poolId,
      params.recipient,
      params.currentBalances,
      params.latestBlockNumberUsed,
      params.protocolFeePercentage,
      params.data
    );
  }

  async grantRole(roleId: string, to?: Account): Promise<ContractTransaction> {
    if (!this.authorizer || !this.admin) throw Error("Missing Vault's authorizer or admin instance");
    if (!to) to = (await ethers.getSigners())[0];
    return this.authorizer.connect(this.admin).grantRole(roleId, TypesConverter.toAddress(to));
  }
}
