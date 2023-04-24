import { ethers } from 'hardhat';
import { SwapKind } from '@balancer-labs/balancer-js';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '../tokens/Token';
import TokenList from '../tokens/TokenList';
import VaultDeployer from './VaultDeployer';
import TypesConverter from '../types/TypesConverter';
import { actionId } from '../misc/actions';
import { deployedAt } from '../../contract';
import { BigNumberish, bn } from '../../numbers';
import { Account, NAry, TxParams } from '../types/types';
import { ANY_ADDRESS, MAX_UINT256, ZERO_ADDRESS } from '../../constants';
import { ExitPool, JoinPool, RawVaultDeployment, MinimalSwap, GeneralSwap, QueryBatchSwap, ProtocolFee } from './types';
import { Interface } from '@ethersproject/abi';

export default class Vault {
  mocked: boolean;
  instance: Contract;
  authorizer: Contract;
  authorizerAdaptor: Contract;
  authorizerAdaptorEntrypoint: Contract;
  protocolFeesProvider: Contract;
  admin?: SignerWithAddress;
  feesCollector?: Contract;

  get interface(): Interface {
    return this.instance.interface;
  }

  static async create(deployment: RawVaultDeployment = {}): Promise<Vault> {
    return VaultDeployer.deploy(deployment);
  }

  constructor(
    mocked: boolean,
    instance: Contract,
    authorizer: Contract,
    authorizerAdaptor: Contract,
    authorizerAdaptorEntrypoint: Contract,
    protocolFeesProvider: Contract,
    admin?: SignerWithAddress
  ) {
    this.mocked = mocked;
    this.instance = instance;
    this.authorizer = authorizer;
    this.authorizerAdaptor = authorizerAdaptor;
    this.authorizerAdaptorEntrypoint = authorizerAdaptorEntrypoint;
    this.protocolFeesProvider = protocolFeesProvider;
    this.admin = admin;
  }

  get address(): string {
    return this.instance.address;
  }

  async getPool(poolId: string): Promise<{ address: string; specialization: BigNumber }> {
    const [address, specialization] = await this.instance.getPool(poolId);
    return { address, specialization };
  }

  async getPoolTokens(
    poolId: string
  ): Promise<{ tokens: string[]; balances: BigNumber[]; lastChangeBlock: BigNumber }> {
    return this.instance.getPoolTokens(poolId);
  }

  async getPoolTokenInfo(
    poolId: string,
    token: Token | string
  ): Promise<{ cash: BigNumber; managed: BigNumber; lastChangeBlock: BigNumber; assetManager: string }> {
    return this.instance.getPoolTokenInfo(poolId, typeof token == 'string' ? token : token.address);
  }

  async updateCash(poolId: string, cash: BigNumberish[]): Promise<ContractTransaction> {
    return this.instance.updateCash(poolId, cash);
  }

  async updateManaged(poolId: string, managed: BigNumberish[]): Promise<ContractTransaction> {
    return this.instance.updateManaged(poolId, managed);
  }

  async minimalSwap(params: MinimalSwap): Promise<ContractTransaction> {
    return this.instance.callMinimalPoolSwap(
      params.poolAddress,
      {
        kind: params.kind,
        poolId: params.poolId,
        from: TypesConverter.toAddress(params.from) ?? ZERO_ADDRESS,
        to: TypesConverter.toAddress(params.to),
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        lastChangeBlock: params.lastChangeBlock,
        userData: params.data,
        amount: params.amount,
      },
      params.balanceTokenIn,
      params.balanceTokenOut
    );
  }

  async generalSwap(params: GeneralSwap): Promise<ContractTransaction> {
    const sender = params.from || (await this._defaultSender());
    const vault = params.from ? this.instance.connect(sender) : this.instance;

    return this.mocked
      ? vault.callGeneralPoolSwap(
          params.poolAddress,
          {
            kind: params.kind,
            poolId: params.poolId,
            from: params.from ?? ZERO_ADDRESS,
            to: params.to,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            lastChangeBlock: params.lastChangeBlock,
            userData: params.data,
            amount: params.amount,
          },
          params.balances,
          params.indexIn,
          params.indexOut
        )
      : vault.swap(
          {
            poolId: params.poolId,
            kind: params.kind,
            assetIn: params.tokenIn,
            assetOut: params.tokenOut,
            amount: params.amount,
            userData: params.data,
          },
          {
            sender: sender.address,
            fromInternalBalance: false,
            recipient: TypesConverter.toAddress(params.to),
            toInternalBalance: false,
          },
          params.kind === SwapKind.GivenIn ? 0 : MAX_UINT256,
          MAX_UINT256
        );
  }

  async joinPool(params: JoinPool): Promise<ContractTransaction> {
    const vault = params.from ? this.instance.connect(params.from) : this.instance;
    return this.mocked
      ? vault.callJoinPool(
          params.poolAddress ?? ZERO_ADDRESS,
          params.poolId,
          params.recipient ?? ZERO_ADDRESS,
          params.currentBalances ?? Array(params.tokens.length).fill(0),
          params.lastChangeBlock ?? 0,
          params.protocolFeePercentage ?? 0,
          params.data ?? '0x'
        )
      : vault.joinPool(
          params.poolId,
          (params.from || (await this._defaultSender())).address,
          params.recipient ?? ZERO_ADDRESS,
          {
            assets: params.tokens,
            maxAmountsIn: params.maxAmountsIn ?? Array(params.tokens.length).fill(MAX_UINT256),
            fromInternalBalance: params.fromInternalBalance ?? false,
            userData: params.data ?? '0x',
          }
        );
  }

  async exitPool(params: ExitPool): Promise<ContractTransaction> {
    const vault = params.from ? this.instance.connect(params.from) : this.instance;

    return this.mocked
      ? vault.callExitPool(
          params.poolAddress ?? ZERO_ADDRESS,
          params.poolId,
          params.recipient ?? ZERO_ADDRESS,
          params.currentBalances ?? Array(params.tokens.length).fill(0),
          params.lastChangeBlock ?? 0,
          params.protocolFeePercentage ?? 0,
          params.data ?? '0x'
        )
      : vault.exitPool(
          params.poolId,
          (params.from || (await this._defaultSender())).address,
          params.recipient ?? ZERO_ADDRESS,
          {
            assets: params.tokens,
            minAmountsOut: params.minAmountsOut ?? Array(params.tokens.length).fill(0),
            toInternalBalance: params.toInternalBalance ?? false,
            userData: params.data ?? '0x',
          }
        );
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
    return this.getFeesProvider().getFeeTypePercentage(ProtocolFee.SWAP);
  }

  async getFlashLoanFeePercentage(): Promise<BigNumber> {
    return this.getFeesProvider().getFeeTypePercentage(ProtocolFee.FLASH_LOAN);
  }

  async getFeesCollector(): Promise<Contract> {
    if (!this.feesCollector) {
      const instance = await this.instance.getProtocolFeesCollector();
      this.feesCollector = await deployedAt('v2-vault/ProtocolFeesCollector', instance);
    }
    return this.feesCollector;
  }

  getFeesProvider(): Contract {
    if (!this.protocolFeesProvider) throw Error('Missing ProtocolFeePercentagesProvider');

    return this.protocolFeesProvider;
  }

  async setSwapFeePercentage(swapFeePercentage: BigNumber, { from }: TxParams = {}): Promise<ContractTransaction> {
    const feesCollector = await this.getFeesCollector();
    const id = await actionId(feesCollector, 'setSwapFeePercentage');

    if (this.authorizer && this.admin && !(await this.hasPermissionGlobally(id, this.admin))) {
      await this.grantPermissionGlobally(id, this.admin);
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
    const id = await actionId(feesCollector, 'setFlashLoanFeePercentage');

    if (this.authorizer && this.admin && !(await this.hasPermissionGlobally(id, this.admin))) {
      await this.grantPermissionGlobally(id, this.admin);
    }

    const sender = from || this.admin;
    const instance = sender ? feesCollector.connect(sender) : feesCollector;
    return instance.setFlashLoanFeePercentage(flashLoanFeePercentage);
  }

  async setFeeTypePercentage(feeType: number, value: BigNumberish): Promise<void> {
    if (!this.admin) throw Error("Missing Vault's admin");

    const feeCollector = await this.getFeesCollector();
    const feeProvider = this.protocolFeesProvider;

    await this.grantPermissionIfNeeded(
      await actionId(feeProvider, 'setFeeTypePercentage'),
      this.admin.address,
      feeProvider.address
    );

    await this.grantPermissionIfNeeded(
      await actionId(feeCollector, 'setSwapFeePercentage'),
      feeProvider.address,
      feeCollector.address
    );

    await this.grantPermissionIfNeeded(
      await actionId(feeCollector, 'setFlashLoanFeePercentage'),
      feeProvider.address,
      feeCollector.address
    );

    await feeProvider.connect(this.admin).setFeeTypePercentage(feeType, bn(value));
  }

  async hasPermissionGlobally(actionId: string, to?: Account): Promise<ContractTransaction> {
    if (!this.authorizer || !this.admin) throw Error("Missing Vault's authorizer or admin instance");
    if (!to) to = await this._defaultSender();
    return this.authorizer.hasPermission(actionId, TypesConverter.toAddress(to), ANY_ADDRESS);
  }

  async grantPermissionGloballyIfNeeded(actionId: string, to?: Account): Promise<ContractTransaction | undefined> {
    if (await this.hasPermissionGlobally(actionId, to)) {
      return undefined;
    }
    return this.grantPermissionGlobally(actionId, to);
  }

  async grantPermissionGlobally(actionId: string, to?: Account): Promise<ContractTransaction> {
    if (!this.authorizer || !this.admin) throw Error("Missing Vault's authorizer or admin instance");
    if (!to) to = await this._defaultSender();
    if (await this.authorizer.hasPermission(actionId, TypesConverter.toAddress(to), ANY_ADDRESS))
      throw Error(`Account ${typeof to === 'string' ? to : to.address} already have global permission for ${actionId}`);
    return this.authorizer.connect(this.admin).grantPermission(actionId, TypesConverter.toAddress(to), ANY_ADDRESS);
  }

  async grantPermissionIfNeeded(
    actionId: string,
    to: Account,
    where: Account
  ): Promise<ContractTransaction | undefined> {
    if (!this.authorizer || !this.admin) throw Error("Missing Vault's authorizer or admin instance");
    if (await this.authorizer.hasPermission(actionId, TypesConverter.toAddress(to), ANY_ADDRESS))
      throw Error(`Account ${typeof to === 'string' ? to : to.address} already have global permission for ${actionId}`);
    if (await this.authorizer.hasPermission(actionId, TypesConverter.toAddress(to), TypesConverter.toAddress(where))) {
      return undefined;
    }
    return this.authorizer
      .connect(this.admin)
      .grantPermission(actionId, TypesConverter.toAddress(to), TypesConverter.toAddress(where));
  }

  async setRelayerApproval(user: SignerWithAddress, relayer: Account, approval: boolean): Promise<ContractTransaction> {
    return this.instance.connect(user).setRelayerApproval(user.address, TypesConverter.toAddress(relayer), approval);
  }

  async _defaultSender(): Promise<SignerWithAddress> {
    const signers = await ethers.getSigners();
    return signers[0];
  }

  // Returns asset deltas
  async queryBatchSwap(params: QueryBatchSwap): Promise<BigNumber[]> {
    return await this.instance.queryBatchSwap(params.kind, params.swaps, params.assets, params.funds);
  }

  async setAuthorizer(newAuthorizer: Account): Promise<ContractTransaction> {
    // Needed to suppress lint warning. grantPermissionGlobally will fail if there is no authorizer or admin
    const admin = this.admin ?? ZERO_ADDRESS;

    const action = await actionId(this.instance, 'setAuthorizer');
    await this.grantPermissionGlobally(action, admin);

    return this.instance.connect(admin).setAuthorizer(TypesConverter.toAddress(newAuthorizer));
  }
}
