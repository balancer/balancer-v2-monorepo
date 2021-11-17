import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { signPermit } from '@balancer-labs/balancer-js';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { Account, NAry, TxParams } from '@balancer-labs/v2-helpers/src/models/types/types';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TypesConverter from '@balancer-labs/v2-helpers/src/models/types/TypesConverter';
import { getSigner } from '@balancer-labs/v2-deployments/dist/src/signers';

export class MultiDistributor {
  instance: Contract;
  vault: Contract;
  admin: SignerWithAddress;
  authorizer: Contract;

  static async create(): Promise<MultiDistributor> {
    const [admin] = await ethers.getSigners();
    const authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });
    const vault = await deploy('v2-vault/Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    const instance = await deploy('MultiDistributor', { args: [vault.address] });
    return new this(instance, authorizer, vault, admin);
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

  async tokensPerStake(distributionId: string): Promise<BigNumber> {
    return this.instance.tokensPerStake(distributionId);
  }

  async getClaimableTokens(distributionId: string, user: SignerWithAddress): Promise<BigNumber> {
    return this.instance.getClaimableTokens(distributionId, user.address);
  }

  async isSubscribed(distribution: string, user1: SignerWithAddress): Promise<boolean> {
    return this.instance.isSubscribed(distribution, user1.address);
  }

  async balanceOf(stakingToken: Token, user: SignerWithAddress): Promise<BigNumber> {
    return this.instance.balanceOf(stakingToken.address, user.address);
  }

  async getDistributionId(stakingToken: Token, distributionToken: Token, owner: SignerWithAddress): Promise<string> {
    return this.instance.getDistributionId(stakingToken.address, distributionToken.address, owner.address);
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
    return instance.subscribe(Array.isArray(ids) ? ids : [ids]);
  }

  async unsubscribe(ids: NAry<string>, params?: TxParams): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.unsubscribe(Array.isArray(ids) ? ids : [ids]);
  }

  async stake(stakingToken: Token, amount: BigNumberish, params?: TxParams): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.stake(stakingToken.address, amount);
  }

  async stakeFor(
    stakingToken: Token,
    amount: BigNumberish,
    to: SignerWithAddress,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.stakeFor(stakingToken.address, amount, to.address);
  }

  async stakeWithPermit(
    stakingToken: Token,
    amount: BigNumberish,
    to: SignerWithAddress,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const sender = params?.from ?? (await getSigner());
    const { v, r, s } = await signPermit(stakingToken.instance, to, this.instance, amount);
    return this.instance
      .connect(sender)
      .stakeWithPermit(stakingToken.address, amount, to.address, MAX_UINT256, v, r, s);
  }

  async subscribeAndStake(id: string, stakingToken: Token, amount: BigNumberish, params?: TxParams): Promise<void> {
    const sender = params?.from ?? (await getSigner());
    await stakingToken.mint(sender, amount);
    await stakingToken.approve(this, amount, params);
    await this.subscribe([id], params);
    await this.stake(stakingToken, amount, params);
  }

  async unstake(stakingToken: Token, amount: BigNumberish, params?: TxParams): Promise<ContractTransaction> {
    const sender = params?.from ?? (await getSigner());
    return this.instance.connect(sender).unstake(stakingToken.address, amount, sender.address);
  }

  async claim(distributions: NAry<string>, params?: TxParams): Promise<ContractTransaction> {
    if (!Array.isArray(distributions)) distributions = [distributions];
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.claim(distributions);
  }

  async exit(stakingTokens: NAry<Token>, distributions: NAry<string>, params?: TxParams): Promise<ContractTransaction> {
    if (!Array.isArray(stakingTokens)) stakingTokens = [stakingTokens];
    if (!Array.isArray(distributions)) distributions = [distributions];
    const instance = params?.from ? this.instance.connect(params.from) : this.instance;
    return instance.exit(TypesConverter.toAddresses(stakingTokens), distributions);
  }
}
