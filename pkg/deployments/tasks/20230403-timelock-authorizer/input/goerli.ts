import fs from 'fs';
import path from 'path';

import { DAY } from '@balancer-labs/v2-helpers/src/time';
import Task, { TaskMode } from '../../../src/task';
import { DelayData, RoleData } from './types';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

const EVERYWHERE = ANY_ADDRESS;

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY, 'goerli');

const BalancerTokenAdmin = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, 'goerli');
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, 'goerli');
const VotingEscrowDelegationProxy = new Task('20220325-ve-delegation', TaskMode.READ_ONLY, 'goerli');
const SmartWalletChecker = new Task('20220420-smart-wallet-checker', TaskMode.READ_ONLY, 'goerli');
const ProtocolFeeWithdrawer = new Task('20220517-protocol-fee-withdrawer', TaskMode.READ_ONLY, 'goerli');

const DAO_MULTISIG = '0x171C0fF5943CE5f133130436A29bF61E26516003';

export const Root = DAO_MULTISIG;

// Permission fetched from TheGraph
// thegraph.com/hosted-service/subgraph/balancer-labs/balancer-authorizer-goerli
// and reconstructed by using the `get-action-id-info` Hardhat command and `action-ids` script
// You can rebuild this file at anytime by running
// hh get-action-ids-info --network goerli > ./tasks/20230403-timelock-authorizer/input/goerli.json
const graphRoles: { taskId: string; signature: string; grantee: string; contractName: string; actionId: string }[] =
  JSON.parse(fs.readFileSync(path.join(__dirname, './goerli.json')).toString());

export const GrantDelays: DelayData[] = [
  {
    actionId: BalancerTokenAdmin.actionId('BalancerTokenAdmin', 'mint(address,uint256)'),
    newDelay: 2 * DAY,
  },
  {
    actionId: GaugeController.actionId('GaugeController', 'add_gauge(address,int128)'),
    newDelay: 1 * DAY,
  },
  {
    actionId: GaugeController.actionId('GaugeController', 'add_gauge(address,int128,uint256)'),
    newDelay: 1 * DAY,
  },
  {
    actionId: GaugeController.actionId('GaugeController', 'change_type_weight(int128,uint256)'),
    newDelay: 1 * DAY,
  },
  {
    actionId: GaugeController.actionId('GaugeController', 'change_gauge_weight(address,uint256)'),
    newDelay: 1 * DAY,
  },
  // BALTokenHolder.withdrawFunds(address, uint256) (veBAL BALTokenHolder)
  // Note this actionId can't be pulled from the json file as the BALTokenHolder is not listed there.
  { actionId: '0x79922681fd17c90b4f3409d605f5b059ffcbcef7b5440321ae93b87f3b5c1c78', newDelay: 0.25 * DAY },
  {
    actionId: Vault.actionId('Vault', 'setRelayerApproval(address,address,bool)'),
    newDelay: 0.25 * DAY,
  },
  {
    actionId: Vault.actionId(
      'Vault',
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)'
    ),
    newDelay: 0.25 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
    newDelay: 0.25 * DAY,
  },
  {
    actionId: Vault.actionId(
      'Vault',
      'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)'
    ),
    newDelay: 0.25 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
    newDelay: 0.25 * DAY,
  },
  {
    actionId: Vault.actionId('Vault', 'manageUserBalance((uint8,address,uint256,address,address)[])'),
    newDelay: 0.25 * DAY,
  },
  {
    actionId: ProtocolFeeWithdrawer.actionId(
      'ProtocolFeesWithdrawer',
      'withdrawCollectedFees(address[],uint256[],address)'
    ),
    newDelay: 0.25 * DAY,
  },
];

export const Roles: RoleData[] = graphRoles
  .map((role) => {
    // if we don't know the signature then do not migrate the role
    // maybe we should throw an error here
    if (!role.signature) {
      throw new Error(`Can't find signature for the actionId ${role.actionId}`);
    }
    return {
      role: new Task(role.taskId, TaskMode.READ_ONLY, 'goerli').actionId(role.contractName, role.signature),
      grantee: role.grantee,
      target: EVERYWHERE,
    };
  })
  .filter((role) => !!role) as RoleData[];

export const Granters: RoleData[] = [];

export const Revokers: RoleData[] = [];

export const ExecuteDelays: DelayData[] = [
  { actionId: Vault.actionId('Vault', 'setAuthorizer(address)'), newDelay: 2 * DAY },
  {
    actionId: SmartWalletChecker.actionId('SmartWalletChecker', 'allowlistAddress(address)'),
    newDelay: 1 * DAY,
  },
  {
    actionId: VotingEscrowDelegationProxy.actionId('VotingEscrowDelegationProxy', 'setDelegation(address)'),
    newDelay: 0.25 * DAY,
  },
];
