import { Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account, NAry, TxParams } from '../types/types';
import { AuthorizerDeployment } from './types';

import AuthorizerDeployer from './AuthorizerDeployer';

export default class Authorizer {
  instance: Contract;
  admin: SignerWithAddress;

  static async create(deployment: AuthorizerDeployment = {}): Promise<Authorizer> {
    return AuthorizerDeployer.deploy(deployment);
  }

  constructor(instance: Contract, admin: SignerWithAddress) {
    this.instance = instance;
    this.admin = admin;
  }

  async canPerform(actions: NAry<string>, account: Account, wheres: NAry<Account>): Promise<boolean> {
    const options = this.permissionsFor(actions, wheres);
    const promises = options.map(([action, where]) => this.instance.canPerform(action, this.toAddress(account), where));
    const results = await Promise.all(promises);
    return results.every(Boolean);
  }

  async grantPermissions(
    actions: string[],
    account: Account,
    wheres: Account[],
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).grantRoles(actions, this.toAddress(account), this.toAddresses(wheres));
  }

  async revokePermissions(
    actions: string[],
    account: Account,
    wheres: Account[],
    params?: TxParams
  ): Promise<ContractTransaction> {
    return this.with(params).revokeRoles(actions, this.toAddress(account), this.toAddresses(wheres));
  }

  async renouncePermissions(actions: string[], wheres: Account[], params?: TxParams): Promise<ContractTransaction> {
    return this.with(params).renounceRoles(actions, this.toAddresses(wheres));
  }

  async grantPermissionsGlobally(actions: string[], account: Account, params?: TxParams): Promise<ContractTransaction> {
    return this.with(params).grantRolesGlobally(actions, this.toAddress(account));
  }

  async revokePermissionsGlobally(actions: string[], account: Account, param?: TxParams): Promise<ContractTransaction> {
    return this.with(param).revokeRolesGlobally(actions, this.toAddress(account));
  }

  async renouncePermissionsGlobally(actions: string[], params?: TxParams): Promise<ContractTransaction> {
    return this.with(params).renounceRolesGlobally(actions);
  }

  with(params: TxParams = {}): Contract {
    return params.from ? this.instance.connect(params.from) : this.instance;
  }

  toAddress(account: Account): string {
    return typeof account === 'string' ? account : account.address;
  }

  toAddresses(accounts: Account[]): string[] {
    return accounts.map(this.toAddress);
  }

  permissionsFor(actions: NAry<string>, wheres: NAry<Account>): string[][] {
    if (!Array.isArray(actions)) actions = [actions];
    if (!Array.isArray(wheres)) wheres = [wheres];
    return actions.flatMap((action) => (wheres as []).map((where) => [action, this.toAddress(where)]));
  }
}
