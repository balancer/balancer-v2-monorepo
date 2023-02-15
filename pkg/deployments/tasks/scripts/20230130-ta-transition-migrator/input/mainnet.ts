import { flatten } from 'lodash';
import Task, { TaskMode } from '../../../../src/task';
import { RoleData } from './types';
import { ANY_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

const EVERYWHERE = ANY_ADDRESS;

const StablePool = new Task('20210624-stable-pool', TaskMode.READ_ONLY, 'mainnet');
const StablePoolV2 = new Task('20220609-stable-pool-v2', TaskMode.READ_ONLY, 'mainnet');
const ComposableStablePool = new Task('20220906-composable-stable-pool', TaskMode.READ_ONLY, 'mainnet');
const ComposableStablePoolV2 = new Task('20221122-composable-stable-pool-v2', TaskMode.READ_ONLY, 'mainnet');
const WeightedPoolV2 = new Task('20220908-weighted-pool-v2', TaskMode.READ_ONLY, 'mainnet');
const NoProtocolFeeLbp = new Task('20211202-no-protocol-fee-lbp', TaskMode.READ_ONLY, 'mainnet');
const ManagedPool = new Task('20221021-managed-pool', TaskMode.READ_ONLY, 'mainnet');
const AaveRebalancedLinearPool = new Task('20220817-aave-rebalanced-linear-pool', TaskMode.READ_ONLY, 'mainnet');
const AaveRebalancedLinearPoolV3 = new Task('20221207-aave-rebalanced-linear-pool-v3', TaskMode.READ_ONLY, 'mainnet');

const PoolRecoveryHelper = new Task('20221123-pool-recovery-helper', TaskMode.READ_ONLY, 'mainnet');

const ArbitrumRootGaugeFactoryV2 = new Task('20220823-arbitrum-root-gauge-factory-v2', TaskMode.READ_ONLY, 'mainnet');

const GaugeAdderV3 = new Task('20230109-gauge-adder-v3', TaskMode.READ_ONLY, 'mainnet');
const GaugeController = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, 'mainnet');

const GaugeAdderV2ToV3Migrator = new Task('20230109-gauge-adder-migration-v2-to-v3', TaskMode.READ_ONLY, 'mainnet');

const BLABS_OPS_MULTISIG = '0x02f35dA6A02017154367Bc4d47bb6c7D06C7533B';
const EMERGENCY_SUBDAO_MULTISIG = '0xa29f61256e948f3fb707b4b3b138c5ccb9ef9888';
const BALLERS_MULTISIG_GAUNTLET = '0xf4a80929163c5179ca042e1b292f5efbbe3d89e6';
const LM_MULTISIG = '0xc38c5f97b34e175ffd35407fc91a937300e33860';

const createRoleData = (grantee: string, target: string, actionIds: string[]): RoleData[] =>
  actionIds.map((actionId) => ({ role: actionId, grantee: grantee.toLowerCase(), target: target.toLowerCase() }));

// Hard-coded roles taken from https://forum.balancer.fi/t/bip-131-pool-factory-permission-granting/4144.
const poolRoles: RoleData[] = flatten([
  createRoleData(BALLERS_MULTISIG_GAUNTLET, EVERYWHERE, [
    ComposableStablePoolV2.actionId('ComposableStablePool', 'setSwapFeePercentage(uint256)'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'startAmplificationParameterUpdate(uint256,uint256)'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'stopAmplificationParameterUpdate()'),
    StablePool.actionId('StablePool', 'setSwapFeePercentage(uint256)'),
    StablePool.actionId('StablePool', 'startAmplificationParameterUpdate(uint256,uint256)'),
    StablePool.actionId('StablePool', 'stopAmplificationParameterUpdate()'),
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, EVERYWHERE, [
    StablePoolV2.actionId('StablePool', 'enableRecoveryMode()'),
    AaveRebalancedLinearPool.actionId('AaveLinearPool', 'enableRecoveryMode()'),
    ComposableStablePool.actionId('ComposableStablePool', 'enableRecoveryMode()'),
    WeightedPoolV2.actionId('WeightedPool', 'enableRecoveryMode()'),
    ManagedPool.actionId('ManagedPool', 'enableRecoveryMode()'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'pause()'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'unpause()'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'enableRecoveryMode()'),
    AaveRebalancedLinearPoolV3.actionId('AaveLinearPool', 'enableRecoveryMode()'),
  ]),

  createRoleData(PoolRecoveryHelper.output().PoolRecoveryHelper, EVERYWHERE, [
    ComposableStablePool.actionId('ComposableStablePool', 'enableRecoveryMode()'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'enableRecoveryMode()'),
    WeightedPoolV2.actionId('WeightedPool', 'enableRecoveryMode()'),
  ]),
]);

const factoryRoles: RoleData[] = flatten([
  createRoleData(BLABS_OPS_MULTISIG, NoProtocolFeeLbp.output().NoProtocolFeeLiquidityBootstrappingPoolFactory, [
    NoProtocolFeeLbp.actionId('NoProtocolFeeLiquidityBootstrappingPoolFactory', 'disable()'),
  ]),

  createRoleData(BLABS_OPS_MULTISIG, AaveRebalancedLinearPool.output().AaveLinearPoolFactory, [
    AaveRebalancedLinearPool.actionId('AaveLinearPoolFactory', 'disable()'),
  ]),

  createRoleData(BLABS_OPS_MULTISIG, ArbitrumRootGaugeFactoryV2.output().ArbitrumRootGaugeFactory, [
    ArbitrumRootGaugeFactoryV2.actionId('ArbitrumRootGaugeFactory', 'setArbitrumFees(uint64,uint64,uint64)'),
  ]),

  createRoleData(BLABS_OPS_MULTISIG, ComposableStablePool.output().ComposableStablePoolFactory, [
    ComposableStablePool.actionId('ComposableStablePoolFactory', 'disable()'),
  ]),

  createRoleData(BLABS_OPS_MULTISIG, WeightedPoolV2.output().WeightedPoolFactory, [
    WeightedPoolV2.actionId('WeightedPoolFactory', 'disable()'),
  ]),

  createRoleData(BLABS_OPS_MULTISIG, ManagedPool.output().ManagedPoolFactory, [
    ManagedPool.actionId('ManagedPoolFactory', 'disable()'),
  ]),

  createRoleData(BLABS_OPS_MULTISIG, ComposableStablePoolV2.output().ComposableStablePoolFactory, [
    ComposableStablePoolV2.actionId('ComposableStablePoolFactory', 'disable()'),
  ]),

  createRoleData(BLABS_OPS_MULTISIG, PoolRecoveryHelper.output().PoolRecoveryHelper, [
    PoolRecoveryHelper.actionId('PoolRecoveryHelper', 'addPoolFactory(address)'),
    PoolRecoveryHelper.actionId('PoolRecoveryHelper', 'removePoolFactory(address)'),
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, AaveRebalancedLinearPool.output().AaveLinearPoolFactory, [
    AaveRebalancedLinearPool.actionId('AaveLinearPoolFactory', 'disable()'),
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, ComposableStablePool.output().ComposableStablePoolFactory, [
    ComposableStablePool.actionId('ComposableStablePoolFactory', 'disable()'),
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, WeightedPoolV2.output().WeightedPoolFactory, [
    WeightedPoolV2.actionId('WeightedPoolFactory', 'disable()'),
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, ManagedPool.output().ManagedPoolFactory, [
    ManagedPool.actionId('ManagedPoolFactory', 'disable()'),
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, ComposableStablePoolV2.output().ComposableStablePoolFactory, [
    ComposableStablePoolV2.actionId('ComposableStablePoolFactory', 'disable()'),
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, AaveRebalancedLinearPoolV3.output().AaveLinearPoolFactory, [
    AaveRebalancedLinearPoolV3.actionId('AaveLinearPoolFactory', 'disable()'),
  ]),
]);

const liquidityMiningRoles: RoleData[] = flatten([
  createRoleData(LM_MULTISIG, GaugeAdderV3.output().GaugeAdder, [
    GaugeAdderV3.actionId('GaugeAdder', 'addEthereumGauge(address)'),
    GaugeAdderV3.actionId('GaugeAdder', 'addPolygonGauge(address)'),
    GaugeAdderV3.actionId('GaugeAdder', 'addArbitrumGauge(address)'),
    GaugeAdderV3.actionId('GaugeAdder', 'addOptimismGauge(address)'),
  ]),
]);

export const delayedRoles: RoleData[] = flatten([
  createRoleData(GaugeAdderV3.output().GaugeAdder, GaugeController.output().GaugeController, [
    GaugeController.actionId('GaugeController', 'add_gauge(address,int128)'),
  ]),
]);

export const roles: RoleData[] = flatten([...poolRoles, ...factoryRoles, ...liquidityMiningRoles]);

// These are on-chain permissions in the old authorizer that should not be migrated to the new authorizer.
export const excludedRoles: RoleData[] = flatten([
  createRoleData(BALLERS_MULTISIG_GAUNTLET, EVERYWHERE, [
    // 20221115-aave-rebalanced-linear-pool - AaveLinearPool - setSwapFeePercentage(uint256)
    '0x0693774dcda5e82a5b5f4255fe8bc7aa5f7ce39cd6b4f9986b116fc4af317450',
    // 20221115-aave-rebalanced-linear-pool - AaveLinearPool - setTargets(uint256,uint256)
    '0x881bd2702150eafb9524fe01e983df0fb0e99eca758c1b3959e46a084cc1618b',
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, EVERYWHERE, [
    // 20221115-aave-rebalanced-linear-pool - AaveLinearPool - pause()
    '0x1f16abe3860c7a3426659e50f0217af96ac40aa554d8ddaebcb7c399118eeb1b',
    // 20221115-aave-rebalanced-linear-pool - AaveLinearPool - unpause()
    '0xcdd7ab46c8258e8c091144b92a3a1061315e0da3aef7773d859de4ee421fd920',
  ]),

  // 20221115-aave-rebalanced-linear-pool - AaveLinearPoolFactory - disable()
  createRoleData(BLABS_OPS_MULTISIG, '0xb5a0a6bceCB2988bb348c2546BbA9c2bD9A04A1e', [
    '0x3924d0d790727bf2925421c7e316cfbe3d8b69f26b36b9d7d1c97e32bdeb4947',
  ]),

  createRoleData(GaugeAdderV2ToV3Migrator.output().GaugeAdderMigrationCoordinator, EVERYWHERE, [
    // Default admin role
    '0x0000000000000000000000000000000000000000000000000000000000000000',
    GaugeAdderV3.actionId('GaugeAdder', 'addGaugeFactory(address,uint8)'),
  ]),
]);
