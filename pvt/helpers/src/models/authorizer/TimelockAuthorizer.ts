import { ethers } from 'hardhat';
import { Interface } from 'ethers/lib/utils';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { getSigner } from '@balancer-labs/v2-deployments/dist/src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../../test/expectEvent';
import { BigNumberish } from '../../numbers';
import { ANY_ADDRESS, ONES_BYTES32 } from '../../constants';

import TimelockAuthorizerDeployer from './TimelockAuthorizerDeployer';
import { TimelockAuthorizerDeployment } from './types';
import { Account, NAry, TxParams } from '../types/types';

export default class TimelockAuthorizer {
  static WHATEVER = ONES_BYTES32;
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

  async getActionId(actionId: string, how: string): Promise<string> {
    return (await this.instance.functions['getActionId(bytes32,bytes32)'](actionId, how))[0];
  }

  async isRoot(account: Account): Promise<boolean> {
    return this.instance.isRoot(this.toAddress(account));
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

  async canPerform(action: string, account: Account, where: Account, how?: string): Promise<boolean> {
    return how
      ? this.instance.canPerformOrWhatever(action, this.toAddress(account), this.toAddress(where), how)
      : this.instance.canPerform(action, this.toAddress(account), this.toAddress(where));
  }

  async hasPermission(action: string, account: Account, where: Account, how: string): Promise<boolean> {
    return this.instance.hasPermissionOrWhatever(action, this.toAddress(account), this.toAddress(where), how);
  }

  async scheduleRootChange(root: Account, executors: Account[], params?: TxParams): Promise<number> {
    const receipt = await this.with(params).scheduleRootChange(this.toAddress(root), this.toAddresses(executors));
    const event = expectEvent.inReceipt(await receipt.wait(), 'ExecutionScheduled');
    return event.args.scheduledExecutionId;
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

  async addGrantPermissionsManager(
    action: string,
    account: Account,
    where: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).manageGrantPermission(action, this.toAddress(account), this.toAddress(where), true);
  }

  async removeGrantPermissionsManager(
    action: string,
    account: Account,
    wheres: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).manageGrantPermission(action, this.toAddress(account), this.toAddress(wheres), false);
  }

  async addRevokePermissionsManager(
    action: string,
    account: Account,
    where: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).manageRevokePermission(action, this.toAddress(account), this.toAddress(where), true);
  }

  async removeRevokePermissionsManager(
    action: string,
    account: Account,
    wheres: Account,
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).manageRevokePermission(action, this.toAddress(account), this.toAddress(wheres), false);
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
