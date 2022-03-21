import { ethers } from 'hardhat';
import { Interface } from 'ethers/lib/utils';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { getSigner } from '@balancer-labs/v2-deployments/dist/src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../../test/expectEvent';
import { ANY_ADDRESS } from '../../constants';
import { BigNumberish } from '../../numbers';
import { TimelockAuthorizerDeployment } from './types';

import { Account, NAry, TxParams } from '../types/types';
import TimelockAuthorizerDeployer from './TimelockAuthorizerDeployer';

export default class TimelockAuthorizer {
  static EVERYWHERE = ANY_ADDRESS;

  instance: Contract;
  admin: SignerWithAddress;

  static async create(deployment: TimelockAuthorizerDeployment = {}): Promise<TimelockAuthorizer> {
    return TimelockAuthorizerDeployer.deploy(deployment);
  }

  constructor(instance: Contract, admin: SignerWithAddress) {
    this.instance = instance;
    this.admin = admin;
  }

  get address(): string {
    return this.instance.address;
  }

  get interface(): Interface {
    return this.instance.interface;
  }

  async GRANT_ACTION_ID(): Promise<string> {
    return this.instance.GRANT_ACTION_ID();
  }

  async REVOKE_ACTION_ID(): Promise<string> {
    return this.instance.REVOKE_ACTION_ID();
  }

  async SCHEDULE_DELAY_ACTION_ID(): Promise<string> {
    return this.instance.SCHEDULE_DELAY_ACTION_ID();
  }

  async permissionId(action: string, account: Account, where: Account): Promise<string> {
    return this.instance.permissionId(action, this.toAddress(account), this.toAddress(where));
  }

  async delay(action: string): Promise<BigNumberish> {
    return this.instance.delaysPerActionId(action);
  }

  async scheduledExecutions(
    id: BigNumberish
  ): Promise<{
    executed: boolean;
    cancelled: boolean;
    protected: boolean;
    executableAt: BigNumber;
    data: string;
    where: string;
  }> {
    return this.instance.scheduledExecutions(id);
  }

  async canPerform(actions: NAry<string>, account: Account, wheres: NAry<Account>): Promise<boolean> {
    const options = this.permissionsFor(actions, wheres);
    const promises = options.map(([action, where]) => this.instance.canPerform(action, this.toAddress(account), where));
    const results = await Promise.all(promises);
    return results.every(Boolean);
  }

  async scheduleDelayChange(action: string, delay: number, executors: Account[], params?: TxParams): Promise<number> {
    const receipt = await this.with(params).scheduleDelayChange(action, delay, this.toAddresses(executors));
    const event = expectEvent.inReceipt(await receipt.wait(), 'ExecutionScheduled');
    return event.args.scheduledExecutionId;
  }

  async schedule(where: Account, data: string, executors: Account[], params?: TxParams): Promise<number> {
    const receipt = await this.with(params).schedule(this.toAddress(where), data, this.toAddresses(executors));
    const event = expectEvent.inReceipt(await receipt.wait(), 'ExecutionScheduled');
    return event.args.scheduledExecutionId;
  }

  async scheduleGrantPermission(
    action: string,
    account: Account,
    where: Account,
    executors: Account[],
    params?: TxParams
  ): Promise<number> {
    const receipt = await this.with(params).scheduleGrantPermission(
      action,
      this.toAddress(account),
      this.toAddress(where),
      this.toAddresses(executors)
    );

    const event = expectEvent.inReceipt(await receipt.wait(), 'ExecutionScheduled');
    return event.args.scheduledExecutionId;
  }

  async scheduleRevokePermission(
    action: string,
    account: Account,
    where: Account,
    executors: Account[],
    params?: TxParams
  ): Promise<number> {
    const receipt = await this.with(params).scheduleRevokePermission(
      action,
      this.toAddress(account),
      this.toAddress(where),
      this.toAddresses(executors)
    );

    const event = expectEvent.inReceipt(await receipt.wait(), 'ExecutionScheduled');
    return event.args.scheduledExecutionId;
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
    const wheres = this.toList(actions).map(() => TimelockAuthorizer.EVERYWHERE);
    return this.with(params).grantPermissions(this.toList(actions), this.toAddress(account), wheres);
  }

  async revokePermissionsGlobally(
    actions: NAry<string>,
    account: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    const wheres = this.toList(actions).map(() => TimelockAuthorizer.EVERYWHERE);
    return this.with(params).revokePermissions(this.toList(actions), this.toAddress(account), wheres);
  }

  async renouncePermissionsGlobally(actions: NAry<string>, params: TxParams): Promise<ContractTransaction> {
    const wheres = this.toList(actions).map(() => TimelockAuthorizer.EVERYWHERE);
    return this.with(params).renouncePermissions(this.toList(actions), wheres);
  }

  async setDelay(action: string, delay: number, params?: TxParams): Promise<void> {
    const from = params?.from ?? (await getSigner());
    const SCHEDULE_DELAY_ACTION_ID = await this.SCHEDULE_DELAY_ACTION_ID();
    const setDelayAction = ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [SCHEDULE_DELAY_ACTION_ID, action]);
    await this.grantPermissions(setDelayAction, this.toAddress(from), this, params);
    const id = await this.scheduleDelayChange(action, delay, [], params);
    await this.execute(id);
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
