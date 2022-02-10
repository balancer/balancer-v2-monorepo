import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../../test/expectEvent';
import { ANY_ADDRESS } from '../../constants';
import { BigNumberish } from '../../numbers';
import { AuthorizerDeployment } from './types';
import { Account, NAry, TxParams } from '../types/types';

import AuthorizerDeployer from './AuthorizerDeployer';

export default class Authorizer {
  static EVERYWHERE = ANY_ADDRESS;

  instance: Contract;
  admin: SignerWithAddress;

  static async create(deployment: AuthorizerDeployment = {}): Promise<Authorizer> {
    return AuthorizerDeployer.deploy(deployment);
  }

  constructor(instance: Contract, admin: SignerWithAddress) {
    this.instance = instance;
    this.admin = admin;
  }

  get address(): string {
    return this.instance.address;
  }

  async GRANT_PERMISSION(): Promise<string> {
    return this.instance.GRANT_PERMISSION();
  }

  async REVOKE_PERMISSION(): Promise<string> {
    return this.instance.REVOKE_PERMISSION();
  }

  async permissionId(action: string, account: Account, where: Account): Promise<string> {
    return this.instance.permissionId(action, this.toAddress(account), this.toAddress(where));
  }

  async delay(action: string): Promise<BigNumberish> {
    return this.instance.delays(action);
  }

  async scheduledActions(
    id: BigNumberish
  ): Promise<{
    executed: boolean;
    cancelled: boolean;
    protected: boolean;
    executableAt: BigNumber;
    data: string;
    where: string;
  }> {
    return this.instance.scheduledActions(id);
  }

  async canPerform(actions: NAry<string>, account: Account, wheres: NAry<Account>): Promise<boolean> {
    const options = this.permissionsFor(actions, wheres);
    const promises = options.map(([action, where]) => this.instance.canPerform(action, this.toAddress(account), where));
    const results = await Promise.all(promises);
    return results.every(Boolean);
  }

  async scheduleDelayChange(action: string, delay: number, executors: Account[], params?: TxParams): Promise<number> {
    const receipt = await this.with(params).scheduleDelayChange(action, delay, this.toAddresses(executors));
    const event = expectEvent.inReceipt(await receipt.wait(), 'ActionScheduled');
    return event.args.id;
  }

  async schedule(where: Account, data: string, executors: Account[], params?: TxParams): Promise<number> {
    const receipt = await this.with(params).schedule(this.toAddress(where), data, this.toAddresses(executors));
    const event = expectEvent.inReceipt(await receipt.wait(), 'ActionScheduled');
    return event.args.id;
  }

  async execute(id: BigNumberish, params?: TxParams): Promise<ContractTransaction> {
    return this.with(params).execute(id);
  }

  async cancel(id: BigNumberish, params?: TxParams): Promise<ContractTransaction> {
    return this.with(params).cancel(id);
  }

  async grantPermissions(
    actions: NAry<string>,
    account: Account,
    wheres: NAry<Account>,
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).grantPermissions(this.toList(actions), this.toAddress(account), this.toAddresses(wheres));
  }

  async revokePermissions(
    actions: NAry<string>,
    account: Account,
    wheres: NAry<Account>,
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).revokePermissions(this.toList(actions), this.toAddress(account), this.toAddresses(wheres));
  }

  async renouncePermissions(
    actions: NAry<string>,
    wheres: NAry<Account>,
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).renouncePermissions(this.toList(actions), this.toAddresses(wheres));
  }

  async grantPermissionsGlobally(
    actions: NAry<string>,
    account: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const wheres = this.toList(actions).map(() => Authorizer.EVERYWHERE);
    return this.with(params).grantPermissions(this.toList(actions), this.toAddress(account), wheres);
  }

  async revokePermissionsGlobally(
    actions: NAry<string>,
    account: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const wheres = this.toList(actions).map(() => Authorizer.EVERYWHERE);
    return this.with(params).revokePermissions(this.toList(actions), this.toAddress(account), wheres);
  }

  async renouncePermissionsGlobally(actions: NAry<string>, params?: TxParams): Promise<ContractTransaction> {
    const wheres = this.toList(actions).map(() => Authorizer.EVERYWHERE);
    return this.with(params).renouncePermissions(this.toList(actions), wheres);
  }

  permissionsFor(actions: NAry<string>, w: NAry<Account>): string[][] {
    return this.toList(actions).flatMap((a) => this.toList(w).map((where) => [a, this.toAddress(where)]));
  }

  toAddress(account: Account): string {
    return typeof account === 'string' ? account : account.address;
  }

  toAddresses(accounts: NAry<Account>): string[] {
    return this.toList(accounts).map(this.toAddress);
  }

  toList<T>(items: NAry<T>): T[] {
    return Array.isArray(items) ? items : [items];
  }

  with(params: TxParams = {}): Contract {
    return params.from ? this.instance.connect(params.from) : this.instance;
  }
}
