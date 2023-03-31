import { DAY } from '@balancer-labs/v2-helpers/src/time';
import { flatten } from 'lodash';
import Task, { TaskMode } from '../../../src/task';
import { DelayData, RoleData } from './types';

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY, 'goerli');

const BalancerTokenAdmin = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, 'goerli');
const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, 'mainnet');
const GaugeAdder = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY, 'goerli');
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, 'goerli');
const VotingEscrowDelegationProxy = new Task('20220325-ve-delegation', TaskMode.READ_ONLY, 'goerli');
const SmartWalletChecker = new Task('20220420-smart-wallet-checker', TaskMode.READ_ONLY, 'goerli');

const DAO_MULTISIG = '0x171C0fF5943CE5f133130436A29bF61E26516003';

const createRoleData = (grantee: string, target: string, actionIds: string[]): RoleData[] =>
  actionIds.map((actionId) => ({ role: actionId, grantee, target }));

// Start: block that contains the transaction that deployed the `TimelockAuthorizer`.
// https://etherscan.io/tx/0x20eb23f4393fd592240ec788f44fb9658cc6ef487b88398e9b76c910294c4eae
// End: close to the current block at the time the `TimelockAuthorizerMigrator` is deployed.
// It is expected that no roles were granted to the old authorizer after it.
// export const TRANSITION_START_BLOCK = 4648094;
export const TRANSITION_START_BLOCK = 8745337;
export const TRANSITION_END_BLOCK = 8745437;

const veBALPermissions: RoleData[] = flatten([
  createRoleData(BalancerMinter.output().BalancerMinter, BalancerTokenAdmin.output().BalancerTokenAdmin, [
    BalancerTokenAdmin.actionId('BalancerTokenAdmin', 'mint(address,uint256)'),
  ]),
  createRoleData(GaugeAdder.output().GaugeAdder, GaugeController.output().GaugeController, [
    GaugeController.actionId('GaugeController', 'add_gauge(address,int128)'),
  ]),
]);

export const Root = DAO_MULTISIG;

export const Roles: RoleData[] = [...veBALPermissions];

export const Granters: RoleData[] = [];

export const Revokers: RoleData[] = [];

export const ExecuteDelays: DelayData[] = [
  { actionId: Vault.actionId('Vault', 'setAuthorizer(address)'), newDelay: 30 * DAY },
  {
    actionId: SmartWalletChecker.actionId('SmartWalletChecker', 'allowlistAddress(address)'),
    newDelay: 7 * DAY,
  },
  {
    actionId: VotingEscrowDelegationProxy.actionId('VotingEscrowDelegationProxy', 'setDelegation(address)'),
    newDelay: 14 * DAY,
  },
];

export const GrantDelays: DelayData[] = [
  {
    actionId: BalancerTokenAdmin.actionId('BalancerTokenAdmin', 'mint(address,uint256)'),
    newDelay: 30 * DAY,
  },
  {
    actionId: GaugeController.actionId('GaugeController', 'add_gauge(address,int128)'),
    newDelay: 14 * DAY,
  },
  {
    actionId: GaugeController.actionId('GaugeController', 'add_gauge(address,int128,uint256)'),
    newDelay: 14 * DAY,
  },
  // BALTokenHolder.withdrawFunds(address, uint256) (veBAL BALTokenHolder)
  // Note this actionId can't be pulled from the json file as the BALTokenHolder is not listed there.
  { actionId: '0x79922681fd17c90b4f3409d605f5b059ffcbcef7b5440321ae93b87f3b5c1c78', newDelay: 7 * DAY },
  {
    actionId: Vault.actionId('Vault', 'setRelayerApproval(address,address,bool)'),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId(
      'Vault',
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)'
    ),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId(
      'Vault',
      'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)'
    ),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
    newDelay: 7 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'manageUserBalance((uint8,address,uint256,address,address)[])'),
    newDelay: 7 * DAY,
  },
];
