import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '../tokens/Token';
import TokenList from '../tokens/TokenList';
import VaultDeployer from './VaultDeployer';
import TypesConverter from '../types/TypesConverter';
import { roleId } from '../../../../lib/helpers/roles';
import { MAX_UINT256 } from '../../../../lib/helpers/constants';
import { BigNumberish } from '../../../../lib/helpers/numbers';
import { Account, NAry, TxParams } from '../types/types';
import { ExitPool, JoinPool, RawVaultDeployment } from './types';

export default class Vault {
  mocked: boolean;
  instance: Contract;
  authorizer?: Contract;
  admin?: SignerWithAddress;
  feesCollector?: Contract;

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

  async getPoolTokens(poolId: string): Promise<{ tokens: string[]; balances: BigNumber[]; maxBlockNumber: BigNumber }> {
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
      : vault.joinPool(params.poolId, (params.from || (await this._defaultSender())).address, params.recipient, {
          assets: params.tokens,
          maxAmountsIn: params.maxAmountsIn ?? Array(params.tokens.length).fill(MAX_UINT256),
          fromInternalBalance: params.fromInternalBalance ?? false,
          userData: params.data,
        });
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
      : vault.exitPool(params.poolId, (params.from || (await this._defaultSender())).address, params.recipient, {
          assets: params.tokens,
          minAmountsOut: params.minAmountsOut ?? Array(params.tokens.length).fill(0),
          toInternalBalance: params.toInternalBalance ?? false,
          userData: params.data,
        });
  }

  async getCollectedFeeAmounts(tokens: TokenList | string[]): Promise<BigNumber[]> {
    const feesCollector = await this.getFeesCollector();
    return feesCollector.getCollectedFeeAmounts(Array.isArray(tokens) ? tokens : tokens.addresses);
  }

  async withdrawCollectedFees(
    tokens: NAry<string>,
    amounts: NAry<BigNumberish>,
    recipient: Account,
    { from }: TxParams = {}
  ): Promise<void> {
    let feesCollector = await this.getFeesCollector();
    if (from) feesCollector = feesCollector.connect(from);
    tokens = Array.isArray(tokens) ? tokens : [tokens];
    amounts = Array.isArray(amounts) ? amounts : [amounts];
    return feesCollector.withdrawCollectedFees(tokens, amounts, TypesConverter.toAddress(recipient));
  }

  async getProtocolFeePercentages(): Promise<{ swapFeePercentage: BigNumber; flashLoanFeePercentage: BigNumber }> {
    return {
      swapFeePercentage: await this.getSwapFeePercentage(),
      flashLoanFeePercentage: await this.getFlashLoanFeePercentage(),
    };
  }

  async getSwapFeePercentage(): Promise<BigNumber> {
    return (await this.getFeesCollector()).getSwapFeePercentage();
  }

  async getFlashLoanFeePercentage(): Promise<BigNumber> {
    return (await this.getFeesCollector()).getFlashLoanFeePercentage();
  }

  async getFeesCollector(): Promise<Contract> {
    if (!this.feesCollector) {
      const instance = await this.instance.getProtocolFeesCollector();
      this.feesCollector = await ethers.getContractAt('ProtocolFeesCollector', instance);
    }
    return this.feesCollector;
  }

  async setSwapFeePercentage(swapFeePercentage: BigNumber, { from }: TxParams = {}): Promise<ContractTransaction> {
    const feesCollector = await this.getFeesCollector();

    if (this.authorizer && this.admin) {
      await this.grantRole(roleId(feesCollector, 'setSwapFeePercentage'), this.admin);
    }

    const sender = from || this.admin;
    const instance = sender ? feesCollector.connect(sender) : feesCollector;
    return instance.setSwapFeePercentage(swapFeePercentage);
  }

  async setFlashLoanFeePercentage(
    flashLoanFeePercentage: BigNumber,
    { from }: TxParams = {}
  ): Promise<ContractTransaction> {
    const feesCollector = await this.getFeesCollector();

    if (this.authorizer && this.admin) {
      await this.grantRole(roleId(feesCollector, 'setFlashLoanFeePercentage'), this.admin);
    }

    const sender = from || this.admin;
    const instance = sender ? feesCollector.connect(sender) : feesCollector;
    return instance.setFlashLoanFeePercentage(flashLoanFeePercentage);
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
