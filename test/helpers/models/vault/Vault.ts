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
  protocolFees?: Contract;

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

  async getCollectedFees(tokens: TokenList | string[]): Promise<BigNumber[]> {
    const protocolFees = await this.getProtocolFeesInstance();
    return protocolFees.getCollectedFees(Array.isArray(tokens) ? tokens : tokens.addresses);
  }

  async withdrawCollectedFees(
    tokens: NAry<string>,
    amounts: NAry<BigNumberish>,
    recipient: Account,
    { from }: TxParams = {}
  ): Promise<void> {
    let protocolFees = await this.getProtocolFeesInstance();
    if (from) protocolFees = protocolFees.connect(from);
    tokens = Array.isArray(tokens) ? tokens : [tokens];
    amounts = Array.isArray(amounts) ? amounts : [amounts];
    return protocolFees.withdrawCollectedFees(tokens, amounts, TypesConverter.toAddress(recipient));
  }

  async getProtocolFees(): Promise<{ swapFee: BigNumber; withdrawFee: BigNumber; flashLoanFee: BigNumber }> {
    return {
      swapFee: await this.getSwapFee(),
      withdrawFee: await this.getSwapFee(),
      flashLoanFee: await this.getSwapFee(),
    };
  }

  async getSwapFee(): Promise<BigNumber> {
    return (await this.getProtocolFeesInstance()).getSwapFee();
  }

  async getWithdrawFee(): Promise<BigNumber> {
    return (await this.getProtocolFeesInstance()).getWithdrawFee();
  }

  async getFlashLoanFee(): Promise<BigNumber> {
    return (await this.getProtocolFeesInstance()).getFlashLoanFee();
  }

  async getProtocolFeesInstance(): Promise<Contract> {
    if (!this.protocolFees) {
      const factory = await ethers.getContractFactory('ProtocolFees');
      this.protocolFees = await factory.attach(await this.instance.getProtocolFees());
    }

    return this.protocolFees;
  }

  async setSwapFee(withdrawFee: BigNumber, { from }: TxParams = {}): Promise<ContractTransaction> {
    const protocolFees = await this.getProtocolFeesInstance();

    if (this.authorizer && this.admin) {
      await this.grantRole(roleId(protocolFees, 'setSwapFee'), this.admin);
    }

    const instance = from || this.admin ? protocolFees.connect((from || this.admin)!) : protocolFees;
    return instance.setSwapFee(withdrawFee);
  }

  async setWithdrawFee(withdrawFee: BigNumber, { from }: TxParams = {}): Promise<ContractTransaction> {
    const protocolFees = await this.getProtocolFeesInstance();

    if (this.authorizer && this.admin) {
      await this.grantRole(roleId(protocolFees, 'setWithdrawFee'), this.admin);
    }
    const instance = from || this.admin ? protocolFees.connect((from || this.admin)!) : protocolFees;
    return instance.setWithdrawFee(withdrawFee);
  }

  async setFlashLoanFee(withdrawFee: BigNumber, { from }: TxParams = {}): Promise<ContractTransaction> {
    const protocolFees = await this.getProtocolFeesInstance();

    if (this.authorizer && this.admin) {
      await this.grantRole(roleId(protocolFees, 'setFlashLoanFee'), this.admin);
    }
    const instance = from || this.admin ? protocolFees.connect((from || this.admin)!) : protocolFees;
    return instance.setFlashLoanFee(withdrawFee);
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
