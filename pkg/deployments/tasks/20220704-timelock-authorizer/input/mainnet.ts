import { DAY } from '@balancer-labs/v2-helpers/src/time';
import Task, { TaskMode } from '../../../src/task';
import { flatten } from 'lodash';
import { DelayData, RoleData } from './types';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

const EVERYWHERE = ANY_ADDRESS;

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY, 'mainnet');
const ProtocolFeesCollector = new Task('20210418-vault', TaskMode.READ_ONLY, 'mainnet');
const ProtocolFeesWithdrawer = new Task('20220517-protocol-fee-withdrawer', TaskMode.READ_ONLY, 'mainnet');

const BalancerTokenAdmin = new Task('20220325-balancer-token-admin', TaskMode.READ_ONLY, 'mainnet');
const BalancerMinter = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, 'mainnet');
const GaugeAdder = new Task('20220628-gauge-adder-v2', TaskMode.READ_ONLY, 'mainnet');
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, 'mainnet');
const VotingEscrowDelegationProxy = new Task('20220325-ve-delegation', TaskMode.READ_ONLY, 'mainnet');
const SmartWalletChecker = new Task('20220420-smart-wallet-checker', TaskMode.READ_ONLY, 'mainnet');
const LiquidityGaugeV5 = new Task('20220325-mainnet-gauge-factory', TaskMode.READ_ONLY, 'mainnet');
const ArbitrumRootGaugeFactory = new Task('20220413-arbitrum-root-gauge-factory', TaskMode.READ_ONLY, 'mainnet');
const OptimismRootGaugeFactory = new Task('20220628-optimism-root-gauge-factory', TaskMode.READ_ONLY, 'mainnet');

const BalancerRelayer = new Task('20211203-batch-relayer', TaskMode.READ_ONLY, 'mainnet');
// BalancerRelayerV2 is not used on mainnet
const BalancerRelayerV3 = new Task('20220720-batch-relayer-v3', TaskMode.READ_ONLY, 'mainnet');
const LidoRelayer = new Task('20210812-lido-relayer', TaskMode.READ_ONLY, 'mainnet');
// https://forum.balancer.fi/t/proposal-balancer-v2-authorize-gnosis-protocol-v2-contracts-as-a-vault-relayer/1938
// https://etherscan.io/address/0xc92e8bdf79f0507f65a392b0ab4667716bfe0110#code
const GnosisProtocolRelayer = '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110';

const SingleRecipientGauge = new Task('20220325-single-recipient-gauge-factory', TaskMode.READ_ONLY, 'mainnet');

const StablePool = new Task('20210624-stable-pool', TaskMode.READ_ONLY, 'mainnet');
const MetaStablePool = new Task('20210727-meta-stable-pool', TaskMode.READ_ONLY, 'mainnet');
const StablePhantomPool = new Task('20211208-stable-phantom-pool', TaskMode.READ_ONLY, 'mainnet');
const WeightedPool = new Task('20210418-weighted-pool', TaskMode.READ_ONLY, 'mainnet');
const AaveLinearPool = new Task('20211208-aave-linear-pool', TaskMode.READ_ONLY, 'mainnet');

const createRoleData = (grantee: string, target: string, actionIds: string[]): RoleData[] =>
  actionIds.map((actionId) => ({ role: actionId, grantee, target }));

const DAO_MULTISIG = '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f';
const BALLERS_MULTISIG = '0x75a52c0e32397a3fc0c052e2ceb3479802713cf4';
const LM_MULTISIG = '0xc38c5f97b34e175ffd35407fc91a937300e33860';
const TREASURY_MULTISIG = '0x7c68c42de679ffb0f16216154c996c354cf1161b';
const EMERGENCY_SUBDAO_MULTISIG = '0xa29f61256e948f3fb707b4b3b138c5ccb9ef9888';
const BLABS_OPS_MULTISIG = '0x02f35dA6A02017154367Bc4d47bb6c7D06C7533B';
const BLABS_VEBAL_MULTISIG = '0xd2eb7bd802a7ca68d9acd209bec4e664a9abdd7b';
const GAUNTLET_FEE_SETTER = '0xe4a8ed6c1d8d048bd29a00946bfcf2db10e7923b';

export const root = DAO_MULTISIG;

const batchRelayerPermissions = [
  BalancerRelayer.output().BalancerRelayer,
  BalancerRelayerV3.output().BalancerRelayer,
].flatMap((relayer) =>
  createRoleData(relayer, Vault.output().Vault, [
    Vault.actionId('Vault', 'setRelayerApproval(address,address,bool)'),
    Vault.actionId(
      'Vault',
      'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)'
    ),
    Vault.actionId('Vault', 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
    Vault.actionId(
      'Vault',
      'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)'
    ),
    Vault.actionId('Vault', 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
    Vault.actionId('Vault', 'manageUserBalance((uint8,address,uint256,address,address)[])'),
  ])
);

const lidoRelayerPermissions = createRoleData(LidoRelayer.output().LidoRelayer, Vault.output().Vault, [
  Vault.actionId(
    'Vault',
    'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)'
  ),
  Vault.actionId('Vault', 'joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
  Vault.actionId(
    'Vault',
    'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)'
  ),
  Vault.actionId('Vault', 'exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))'),
  Vault.actionId('Vault', 'manageUserBalance((uint8,address,uint256,address,address)[])'),
]);

const gnosisProtocolRelayerPermissions = createRoleData(GnosisProtocolRelayer, Vault.output().Vault, [
  Vault.actionId(
    'Vault',
    'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)'
  ),
  Vault.actionId('Vault', 'manageUserBalance((uint8,address,uint256,address,address)[])'),
]);

const protocolFeesPermissions: RoleData[] = flatten([
  createRoleData(
    ProtocolFeesWithdrawer.output().ProtocolFeesWithdrawer,
    ProtocolFeesCollector.output().ProtocolFeesCollector,
    [Vault.actionId('ProtocolFeesCollector', 'withdrawCollectedFees(address[],uint256[],address)')]
  ),
  createRoleData(TREASURY_MULTISIG, ProtocolFeesWithdrawer.output().ProtocolFeesWithdrawer, [
    ProtocolFeesWithdrawer.actionId('ProtocolFeesWithdrawer', 'withdrawCollectedFees(address[],uint256[],address)'),
  ]),
  createRoleData(EMERGENCY_SUBDAO_MULTISIG, ProtocolFeesWithdrawer.output().ProtocolFeesWithdrawer, [
    ProtocolFeesWithdrawer.actionId('ProtocolFeesWithdrawer', 'denylistToken(address)'),
  ]),
]);

const veBALPermissions: RoleData[] = flatten([
  createRoleData(BalancerMinter.output().BalancerMinter, BalancerTokenAdmin.output().BalancerTokenAdmin, [
    BalancerTokenAdmin.actionId('BalancerTokenAdmin', 'mint(address,uint256)'),
  ]),
  createRoleData(GaugeAdder.output().GaugeAdder, GaugeController.output().GaugeController, [
    GaugeController.actionId('GaugeController', 'add_gauge(address,int128)'),
  ]),
  createRoleData(LM_MULTISIG, GaugeAdder.output().GaugeAdder, [
    GaugeAdder.actionId('GaugeAdder', 'addEthereumGauge(address)'),
    GaugeAdder.actionId('GaugeAdder', 'addPolygonGauge(address)'),
    GaugeAdder.actionId('GaugeAdder', 'addArbitrumGauge(address)'),
    GaugeAdder.actionId('GaugeAdder', 'addOptimismGauge(address)'),
  ]),
  createRoleData(LM_MULTISIG, EVERYWHERE, [
    LiquidityGaugeV5.actionId('LiquidityGaugeV5', 'add_reward(address,address)'),
    LiquidityGaugeV5.actionId('LiquidityGaugeV5', 'set_reward_distributor(address,address)'),
  ]),
  createRoleData(EMERGENCY_SUBDAO_MULTISIG, EVERYWHERE, [LiquidityGaugeV5.actionId('LiquidityGaugeV5', 'killGauge()')]),
  createRoleData(DAO_MULTISIG, SmartWalletChecker.output().SmartWalletChecker, [
    SmartWalletChecker.actionId('SmartWalletChecker', 'denylistAddress(address)'),
    SmartWalletChecker.actionId('SmartWalletChecker', 'allowlistAddress(address)'),
  ]),
  createRoleData(BLABS_OPS_MULTISIG, EVERYWHERE, [
    // This permission grants powers to call `checkpoint()` on all of SingleRecipientGauges, PolygonRootGauges, ArbitrumRootGauges.
    SingleRecipientGauge.actionId('SingleRecipientGauge', 'checkpoint()'),
  ]),
  createRoleData(BLABS_OPS_MULTISIG, ArbitrumRootGaugeFactory.output().ArbitrumRootGaugeFactory, [
    ArbitrumRootGaugeFactory.actionId('ArbitrumRootGaugeFactory', 'setArbitrumFees(uint64,uint64,uint64)'),
  ]),
  createRoleData(BLABS_OPS_MULTISIG, OptimismRootGaugeFactory.output().OptimismRootGaugeFactory, [
    OptimismRootGaugeFactory.actionId('OptimismRootGaugeFactory', 'setOptimismGasLimit(uint32)'),
  ]),
  // BALTokenHolder.withdrawFunds(address, uint256) (veBAL BALTokenHolder)
  // Note this actionId can't be pulled from the json file as the BALTokenHolder is not listed there.
  {
    role: '0x79922681fd17c90b4f3409d605f5b059ffcbcef7b5440321ae93b87f3b5c1c78',
    grantee: BLABS_VEBAL_MULTISIG,
    target: '0x3c1d00181ff86fbac0c3c52991fbfd11f6491d70',
  },
]);

const feesAndTargetsPermissions: RoleData[] = flatten([
  createRoleData(DAO_MULTISIG, ProtocolFeesCollector.output().ProtocolFeesCollector, [
    ProtocolFeesCollector.actionId('ProtocolFeesCollector', 'setSwapFeePercentage(uint256)'),
  ]),
  createRoleData(GAUNTLET_FEE_SETTER, EVERYWHERE, [
    StablePool.actionId('StablePool', 'setSwapFeePercentage(uint256)'),
    MetaStablePool.actionId('MetaStablePool', 'setSwapFeePercentage(uint256)'),
    StablePhantomPool.actionId('StablePhantomPool', 'setSwapFeePercentage(uint256)'),
    WeightedPool.actionId('WeightedPool', 'setSwapFeePercentage(uint256)'),
    WeightedPool.actionId('WeightedPool2Tokens', 'setSwapFeePercentage(uint256)'),
  ]),
  createRoleData(BALLERS_MULTISIG, EVERYWHERE, [
    StablePhantomPool.actionId('StablePhantomPool', 'setTokenRateCacheDuration(address,uint256)'),
    AaveLinearPool.actionId('AaveLinearPool', 'setSwapFeePercentage(uint256)'),
    AaveLinearPool.actionId('AaveLinearPool', 'setTargets(uint256,uint256)'),
  ]),
]);

export const roles: RoleData[] = flatten([
  ...batchRelayerPermissions,
  ...lidoRelayerPermissions,
  ...gnosisProtocolRelayerPermissions,
  ...protocolFeesPermissions,
  ...veBALPermissions,
  ...feesAndTargetsPermissions,
]);

export const granters: RoleData[] = flatten([
  createRoleData(BLABS_OPS_MULTISIG, EVERYWHERE, [
    SingleRecipientGauge.actionId('SingleRecipientGauge', 'checkpoint()'),
  ]),
]);
export const revokers: RoleData[] = [];
export const executeDelays: DelayData[] = [
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

export const grantDelays: DelayData[] = [
  {
    actionId: BalancerTokenAdmin.actionId('BalancerTokenAdmin', 'mint(address,uint256)'),
    newDelay: 30 * DAY,
  },
  {
    actionId: Vault.actionId('ProtocolFeesCollector', 'withdrawCollectedFees(address[],uint256[],address)'),
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
  {
    actionId: GaugeAdder.actionId('GaugeAdder', 'addEthereumGauge(address)'),
    newDelay: 7 * DAY,
  },
  {
    actionId: GaugeAdder.actionId('GaugeAdder', 'addPolygonGauge(address)'),
    newDelay: 7 * DAY,
  },
  {
    actionId: GaugeAdder.actionId('GaugeAdder', 'addArbitrumGauge(address)'),
    newDelay: 7 * DAY,
  },
  {
    actionId: GaugeAdder.actionId('GaugeAdder', 'addOptimismGauge(address)'),
    newDelay: 7 * DAY,
  },
  {
    actionId: GaugeAdder.actionId('GaugeAdder', 'addGaugeFactory(address,uint8)'),
    newDelay: 7 * DAY,
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
