import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { Interface } from 'ethers/lib/utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { signPermit } from '@balancer-labs/balancer-js';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { Account, NAry, TxParams } from '@balancer-labs/v2-helpers/src/models/types/types';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { getSigner } from '@balancer-labs/v2-deployments/dist/src/signers';
import Vault from '../vault/Vault';

export class MultiDistributor {
  instance: Contract;
  vault: Contract;
  admin: SignerWithAddress;
  authorizer: Contract;

  get interface(): Interface {
    return this.instance.interface;
  }

  static async create(vault: Vault): Promise<MultiDistributor> {
    if (!vault.authorizer || !vault.admin) throw 'Invalid Vault deployment';
    const instance = await deploy('v2-distributors/MultiDistributor', { args: [vault.address] });
    return new this(instance, vault.authorizer, vault.instance, vault.admin);
  }

  constructor(instance: Contract, authorizer: Contract, vault: Contract, admin: SignerWithAddress) {
    this.instance = instance;
    this.vault = vault;
    this.admin = admin;
    this.authorizer = authorizer;
  }

  get address(): string {
    return this.instance.address;
  }

  async getAuthorizer(): Promise<string> {
    return this.instance.getAuthorizer();
  }

  async totalSupply(distributionId: string): Promise<BigNumber> {
    return this.instance.totalSupply(distributionId);
  }

  async globalTokensPerStake(distributionId: string): Promise<BigNumber> {
    return this.instance.globalTokensPerStake(distributionId);
  }

  async getClaimableTokens(distributionId: string, user: Account): Promise<BigNumber> {
    return this.instance.getClaimableTokens(distributionId, TypesConverter.toAddress(user));
  }

  async isSubscribed(distribution: string, user1: SignerWithAddress): Promise<boolean> {
    return this.instance.isSubscribed(distribution, user1.address);
  }

  async balanceOf(stakingToken: Token, user: SignerWithAddress): Promise<BigNumber> {
    return this.instance.balanceOf(stakingToken.address, user.address);
  }

  async getDistributionId(stakingToken: Token, distributionToken: Token, owner: Account): Promise<string> {
    return this.instance.getDistributionId(
      TypesConverter.toAddress(stakingToken),
      TypesConverter.toAddress(distributionToken),
      TypesConverter.toAddress(owner)
    );
  }

  async getDistribution(
    distributionId: string
  ): Promise<{
    stakingToken: string;
    distributionToken: string;
    owner: string;
    totalSupply: BigNumber;
    duration: BigNumber;
    periodFinish: BigNumber;
    paymentRate: BigNumber;
    lastUpdateTime: BigNumber;
    globalTokensPerStake: BigNumber;
  }> {
    return this.instance.getDistribution(distributionId);
  }

  async getUserDistribution(
    distributionId: string,
    user: SignerWithAddress
  ): Promise<{ unclaimedTokens: BigNumber; userTokensPerStake: BigNumber }> {
    return this.instance.getUserDistribution(distributionId, user.address);
  }

  async newDistribution(
    stakingToken: Account,
    rewardsToken: Account,
    duration: BigNumberish,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.createDistribution(
      TypesConverter.toAddress(stakingToken),
      TypesConverter.toAddress(rewardsToken),
      duration
    );
  }

  async fundDistribution(distribution: string, amount: BigNumberish, params?: TxParams): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.fundDistribution(distribution, amount);
  }

  async setDuration(distribution: string, newDuration: BigNumberish, params?: TxParams): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.setDistributionDuration(distribution, newDuration);
  }

  async subscribe(ids: NAry<string>, params?: TxParams): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.subscribeDistributions(Array.isArray(ids) ? ids : [ids]);
  }

  async unsubscribe(ids: NAry<string>, params?: TxParams): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.unsubscribeDistributions(Array.isArray(ids) ? ids : [ids]);
  }

  async stake(
    stakingToken: Token,
    amount: BigNumberish,
    sender: Account,
    recipient: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    const [senderAddress, recipientAddress] = TypesConverter.toAddresses([sender, recipient]);
    return instance.stake(stakingToken.address, amount, senderAddress, recipientAddress);
  }

  async stakeUsingVault(
    stakingToken: Token,
    amount: BigNumberish,
    sender: Account,
    recipient: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    const [senderAddress, recipientAddress] = TypesConverter.toAddresses([sender, recipient]);
    return instance.stakeUsingVault(stakingToken.address, amount, senderAddress, recipientAddress);
  }

  async stakeWithPermit(
    stakingToken: Token,
    amount: BigNumberish,
    to: SignerWithAddress,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const sender = params?.from ?? (await getSigner());
    const { v, r, s } = await signPermit(stakingToken.instance, to, this.address, amount);
    return this.instance
      .connect(sender)
      .stakeWithPermit(stakingToken.address, amount, to.address, MAX_UINT256, v, r, s);
  }

  async subscribeAndStake(id: string, stakingToken: Token, amount: BigNumberish, params?: TxParams): Promise<void> {
    const sender = params?.from ?? (await getSigner());
    await stakingToken.mint(sender, amount);
    await stakingToken.approve(this.address, amount, params);
    await this.subscribe([id], params);
    await this.stake(stakingToken, amount, sender, sender, params);
  }

  async unstake(
    stakingToken: Token,
    amount: BigNumberish,
    sender: Account,
    recipient: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    const [senderAddress, recipientAddress] = TypesConverter.toAddresses([sender, recipient]);
    return instance.unstake(stakingToken.address, amount, senderAddress, recipientAddress);
  }

  async claim(
    distributions: NAry<string>,
    toInternalBalance: boolean,
    sender: Account,
    recipient: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    if (!Array.isArray(distributions)) distributions = [distributions];
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    const [senderAddress, recipientAddress] = TypesConverter.toAddresses([sender, recipient]);
    return instance.claim(distributions, toInternalBalance, senderAddress, recipientAddress);
  }

  async claimWithCallback(
    distributions: NAry<string>,
    sender: Account,
    callbackContract: Account,
    callbackData: string,
    params?: TxParams
  ): Promise<ContractTransaction> {
    if (!Array.isArray(distributions)) distributions = [distributions];
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.claimWithCallback(
      distributions,
      TypesConverter.toAddress(sender),
      TypesConverter.toAddress(callbackContract),
      callbackData
    );
  }

  async exit(stakingTokens: NAry<Token>, distributions: NAry<string>, params?: TxParams): Promise<ContractTransaction> {
    if (!Array.isArray(stakingTokens)) stakingTokens = [stakingTokens];
    if (!Array.isArray(distributions)) distributions = [distributions];
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.exit(TypesConverter.toAddresses(stakingTokens), distributions);
  }
}
