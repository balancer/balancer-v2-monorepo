import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BasePoolEncoder } from '@balancer-labs/balancer-js';
import { ZERO_ADDRESS } from '../../../constants';
import * as expectEvent from '../../../test/expectEvent';
import TypesConverter from '../../types/TypesConverter';
import { BigNumberish, bn, fp } from '../../../numbers';
import { Account } from '../../types/types';
import TokenList from '../../tokens/TokenList';
import { actionId } from '../../misc/actions';
import Token from '../../tokens/Token';
import Vault from '../../vault/Vault';

import { RecoveryModeExitParams, ExitResult, JoinExitBasePool, FailureMode } from './types';

export default class BasePool {
  instance: Contract;
  poolId: string;
  tokens: TokenList;
  swapFeePercentage: BigNumberish;
  vault: Vault;
  owner?: SignerWithAddress;

  constructor(
    instance: Contract,
    poolId: string,
    vault: Vault,
    tokens: TokenList,
    swapFeePercentage: BigNumberish,
    owner?: SignerWithAddress
  ) {
    this.instance = instance;
    this.poolId = poolId;
    this.vault = vault;
    this.tokens = tokens;
    this.swapFeePercentage = swapFeePercentage;
    this.owner = owner;
  }

  get address(): string {
    return this.instance.address;
  }

  async name(): Promise<string> {
    return this.instance.name();
  }

  async symbol(): Promise<string> {
    return this.instance.symbol();
  }

  async decimals(): Promise<BigNumber> {
    return this.instance.decimals();
  }

  async totalSupply(): Promise<BigNumber> {
    return this.instance.totalSupply();
  }

  async balanceOf(account: Account): Promise<BigNumber> {
    return this.instance.balanceOf(TypesConverter.toAddress(account));
  }

  async getVault(): Promise<string> {
    return this.instance.getVault();
  }

  async getOwner(): Promise<string> {
    return this.instance.getOwner();
  }

  async getRegisteredInfo(): Promise<{ address: string; specialization: BigNumber }> {
    return this.vault.getPool(this.poolId);
  }

  async getPoolId(): Promise<string> {
    return this.instance.getPoolId();
  }

  async getSwapFeePercentage(): Promise<BigNumber> {
    return this.instance.getSwapFeePercentage();
  }

  async getScalingFactors(): Promise<BigNumber[]> {
    return this.instance.getScalingFactors();
  }

  async getScalingFactor(token: Token): Promise<BigNumber> {
    return this.instance.getScalingFactor(token.address);
  }

  async upscale(balances: BigNumberish[]): Promise<BigNumberish[]> {
    const scalingFactors = await this.getScalingFactors();
    return balances.map((b, i) => bn(b).mul(scalingFactors[i]).div(fp(1)));
  }

  async downscale(balances: BigNumberish[]): Promise<BigNumberish[]> {
    const scalingFactors = await this.getScalingFactors();
    return balances.map((b, i) => bn(b).mul(fp(1)).div(scalingFactors[i]));
  }

  async getTokens(): Promise<{ tokens: string[]; balances: BigNumber[]; lastChangeBlock: BigNumber }> {
    return this.vault.getPoolTokens(this.poolId);
  }

  async getBalances(): Promise<BigNumber[]> {
    const { balances } = await this.getTokens();
    return balances;
  }

  async getRate(): Promise<BigNumber> {
    return this.instance.getRate();
  }

  async getTokenInfo(
    token: Token
  ): Promise<{ cash: BigNumber; managed: BigNumber; lastChangeBlock: BigNumber; assetManager: string }> {
    return this.vault.getPoolTokenInfo(this.poolId, token);
  }

  async recoveryModeExit(params: RecoveryModeExitParams): Promise<ExitResult> {
    return this.exit(this._buildRecoveryModeExitParams(params));
  }

  private _buildRecoveryModeExitParams(params: RecoveryModeExitParams): JoinExitBasePool {
    return {
      from: params.from,
      recipient: params.recipient,
      tokens: params.tokens,
      currentBalances: params.currentBalances,
      data: BasePoolEncoder.recoveryModeExit(params.bptIn),
    };
  }

  async exit(params: JoinExitBasePool): Promise<ExitResult> {
    const currentBalances = params.currentBalances || (await this.getBalances());
    const to = params.recipient ? TypesConverter.toAddress(params.recipient) : params.from?.address ?? ZERO_ADDRESS;
    const { tokens: allTokens } = await this.getTokens();

    const tx = await this.vault.exitPool({
      poolAddress: this.address,
      poolId: this.poolId,
      recipient: to,
      currentBalances,
      tokens: allTokens,
      lastChangeBlock: params.lastChangeBlock ?? 0,
      protocolFeePercentage: params.protocolFeePercentage ?? 0,
      data: params.data ?? '0x',
      from: params.from,
    });

    const receipt = await (await tx).wait();
    const { deltas, protocolFees } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
    return { amountsOut: deltas.map((x: BigNumber) => x.mul(-1)), dueProtocolFeeAmounts: protocolFees };
  }

  async pause(): Promise<void> {
    await this.grantPausePermissions();
    await this.instance.pause();
  }

  async unpause(): Promise<void> {
    await this.grantPausePermissions();
    await this.instance.unpause();
  }

  async enableRecoveryMode(from: SignerWithAddress): Promise<ContractTransaction> {
    await this.grantRecoveryPermissions();
    const pool = this.instance.connect(from);
    return await pool.enableRecoveryMode();
  }

  async disableRecoveryMode(from: SignerWithAddress): Promise<ContractTransaction> {
    await this.grantRecoveryPermissions();
    const pool = this.instance.connect(from);
    return await pool.disableRecoveryMode();
  }

  async inRecoveryMode(): Promise<boolean> {
    return await this.instance.inRecoveryMode();
  }

  async setInvariantFailure(invariantFailsToConverge: boolean): Promise<void> {
    await this.instance.setFailureMode(FailureMode.INVARIANT, invariantFailsToConverge);
  }

  async setRateFailure(priceRateReverts: boolean): Promise<void> {
    await this.instance.setFailureMode(FailureMode.PRICE_RATE, priceRateReverts);
  }

  private async grantPausePermissions(): Promise<void> {
    const pauseAction = await actionId(this.instance, 'pause');
    const unpauseAction = await actionId(this.instance, 'unpause');
    await this.vault.grantPermissionsGlobally([pauseAction, unpauseAction]);
  }

  private async grantRecoveryPermissions(): Promise<void> {
    const enableRecoveryAction = await actionId(this.instance, 'enableRecoveryMode');
    const disableRecoveryAction = await actionId(this.instance, 'disableRecoveryMode');
    await this.vault.grantPermissionsGlobally([enableRecoveryAction, disableRecoveryAction], this.vault.admin);
  }
}
