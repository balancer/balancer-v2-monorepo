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

const DAO_MULTISIG = '0x171C0fF5943CE5f133130436A29bF61E26516003';

export const Root = DAO_MULTISIG;

// Permission fetched from TheGraph
// thegraph.com/hosted-service/subgraph/balancer-labs/balancer-authorizer-goerli
// and reconstructed by using the `get-action-id-info` Hardhat command and `action-ids` script
const graphRoles = [
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
  },
  {
    taskId: '20220325-balancer-token-admin',
    contract: 'BalancerTokenAdmin',
    signature: 'activate()',
    grantee: '0x2122a7fcc2eebf59cdf532ebfd197d56343e34a0',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'manageUserBalance((uint8,address,uint256,address,address)[])',
    grantee: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'manageUserBalance((uint8,address,uint256,address,address)[])',
    grantee: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
  },
  {
    taskId: '20220325-gauge-adder',
    contract: 'GaugeAdder',
    signature: 'addArbitrumGauge(address)',
    grantee: '0x3babebfd684506a5b47701ee231a53427ad413ef',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'setRelayerApproval(address,address,bool)',
    grantee: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
  },
  {
    taskId: '20220325-gauge-adder',
    contract: 'GaugeAdder',
    signature: 'addEthereumGauge(address)',
    grantee: '0x3babebfd684506a5b47701ee231a53427ad413ef',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature:
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)',
    grantee: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
  },
  {
    taskId: '20220325-gauge-adder',
    contract: 'GaugeAdder',
    signature: 'addPolygonGauge(address)',
    grantee: '0x3babebfd684506a5b47701ee231a53427ad413ef',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature:
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)',
    grantee: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
  },
  {
    taskId: '20220325-mainnet-gauge-factory',
    contract: 'LiquidityGaugeV5',
    signature: 'killGauge()',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20220822-mainnet-gauge-factory-v2',
    contract: 'LiquidityGaugeV5',
    signature: 'killGauge()',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20230215-single-recipient-gauge-factory-v2',
    contract: 'SingleRecipientGauge',
    signature: 'killGauge()',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20230316-child-chain-gauge-factory-v2',
    contract: 'ChildChainGauge',
    signature: 'killGauge()',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature:
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)',
    grantee: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
  },
  {
    taskId: '20220420-smart-wallet-checker',
    contract: 'SmartWalletChecker',
    signature: 'denylistAddress(address)',
    grantee: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  },
  {
    taskId: '20220325-mainnet-gauge-factory',
    contract: 'LiquidityGaugeV5',
    signature: 'add_reward(address,address)',
    grantee: '0x3babebfd684506a5b47701ee231a53427ad413ef',
  },
  {
    taskId: '20220822-mainnet-gauge-factory-v2',
    contract: 'LiquidityGaugeV5',
    signature: 'add_reward(address,address)',
    grantee: '0x3babebfd684506a5b47701ee231a53427ad413ef',
  },
  {
    taskId: '20230316-child-chain-gauge-factory-v2',
    contract: 'ChildChainGauge',
    signature: 'add_reward(address,address)',
    grantee: '0x3babebfd684506a5b47701ee231a53427ad413ef',
  },
  {
    taskId: '20220325-gauge-controller',
    contract: 'GaugeController',
    signature: 'add_gauge(address,int128)',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20220325-mainnet-gauge-factory',
    contract: 'LiquidityGaugeV5',
    signature: 'killGauge()',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20220822-mainnet-gauge-factory-v2',
    contract: 'LiquidityGaugeV5',
    signature: 'killGauge()',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20230215-single-recipient-gauge-factory-v2',
    contract: 'SingleRecipientGauge',
    signature: 'killGauge()',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20230316-child-chain-gauge-factory-v2',
    contract: 'ChildChainGauge',
    signature: 'killGauge()',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20220325-gauge-adder',
    contract: 'GaugeAdder',
    signature: 'addEthereumGauge(address)',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'manageUserBalance((uint8,address,uint256,address,address)[])',
    grantee: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
  },
  {
    taskId: '20220325-mainnet-gauge-factory',
    contract: 'LiquidityGaugeV5',
    signature: 'unkillGauge()',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20220822-mainnet-gauge-factory-v2',
    contract: 'LiquidityGaugeV5',
    signature: 'unkillGauge()',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20230215-single-recipient-gauge-factory-v2',
    contract: 'SingleRecipientGauge',
    signature: 'unkillGauge()',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20230316-child-chain-gauge-factory-v2',
    contract: 'ChildChainGauge',
    signature: 'unkillGauge()',
    grantee: '0x3b1836c09fdae0a7c2848f99b2584aebd6a36876',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x4b1635c7d3d1fc353298f92083e82df69e1e9158',
  },
  {
    taskId: '20220420-smart-wallet-checker',
    contract: 'SmartWalletChecker',
    signature: 'denylistAddress(address)',
    grantee: '0x3babebfd684506a5b47701ee231a53427ad413ef',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)',
    grantee: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
  },
  {
    taskId: '20220325-mainnet-gauge-factory',
    contract: 'LiquidityGaugeV5',
    signature: 'set_reward_distributor(address,address)',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20220413-child-chain-gauge-factory',
    contract: 'ChildChainStreamer',
    signature: 'set_reward_distributor(address,address)',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20220822-mainnet-gauge-factory-v2',
    contract: 'LiquidityGaugeV5',
    signature: 'set_reward_distributor(address,address)',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20230316-child-chain-gauge-factory-v2',
    contract: 'ChildChainGauge',
    signature: 'set_reward_distributor(address,address)',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
  },
  {
    taskId: '20220325-balancer-token-admin',
    contract: 'BalancerTokenAdmin',
    signature: 'mint(address,uint256)',
    grantee: '0xdf0399539a72e2689b8b2dd53c3c2a0883879fdd',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature:
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)',
    grantee: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'manageUserBalance((uint8,address,uint256,address,address)[])',
    grantee: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'setRelayerApproval(address,address,bool)',
    grantee: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
  },
  {
    taskId: '20220420-smart-wallet-checker',
    contract: 'SmartWalletChecker',
    signature: 'allowlistAddress(address)',
    grantee: '0x171c0ff5943ce5f133130436a29bf61e26516003',
  },
  {
    taskId: '20220325-mainnet-gauge-factory',
    contract: 'LiquidityGaugeV5',
    signature: 'add_reward(address,address)',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20220822-mainnet-gauge-factory-v2',
    contract: 'LiquidityGaugeV5',
    signature: 'add_reward(address,address)',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20230316-child-chain-gauge-factory-v2',
    contract: 'ChildChainGauge',
    signature: 'add_reward(address,address)',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'manageUserBalance((uint8,address,uint256,address,address)[])',
    grantee: '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
  },
  {
    taskId: '20220325-gauge-controller',
    contract: 'GaugeController',
    signature: 'change_type_weight(int128,uint256)',
    grantee: '0xe0a171587b1cae546e069a943eda96916f5ee977',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))',
    grantee: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
  },
  {
    taskId: '20220420-smart-wallet-checker',
    contract: 'SmartWalletChecker',
    signature: 'allowlistAddress(address)',
    grantee: '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  },
  {
    taskId: '20220420-smart-wallet-checker',
    contract: 'SmartWalletChecker',
    signature: 'allowlistAddress(address)',
    grantee: '0x3babebfd684506a5b47701ee231a53427ad413ef',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'setRelayerApproval(address,address,bool)',
    grantee: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature:
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)',
    grantee: '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)',
    grantee: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature:
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)',
    grantee: '0x7b9b6f094dc2bd1c12024b0d9cc63d6993be1888',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'setRelayerApproval(address,address,bool)',
    grantee: '0x00e695aa8000df01b8dc8401b4c34fba5d56bbb2',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'manageUserBalance((uint8,address,uint256,address,address)[])',
    grantee: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
  },
  {
    taskId: '20220325-gauge-controller',
    contract: 'GaugeController',
    signature: 'add_gauge(address,int128)',
    grantee: '0x0df18b22fb1dd4c1d4bfbf783a8acf0758979328',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'setRelayerApproval(address,address,bool)',
    grantee: '0x2fb8ad26fadc971464a17407e9213d1a22befc8a',
  },
  {
    taskId: '20210418-vault',
    contract: 'Vault',
    signature: 'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)',
    grantee: '0x03f1ab8b19bce21eb06c364aec9e40322572a1e9',
  },
];

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
];

export const Roles: RoleData[] = graphRoles.map((role) => ({
  role: new Task(role.taskId, TaskMode.READ_ONLY, 'goerli').actionId(role.contract, role.signature),
  grantee: role.grantee,
  target: EVERYWHERE,
}));

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
