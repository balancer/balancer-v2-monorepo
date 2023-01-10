import { flatten } from 'lodash';
import Task, { TaskMode } from '../../../../src/task';
import { RoleData } from './types';

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

const BLABS_OPS_MULTISIG = '0x02f35dA6A02017154367Bc4d47bb6c7D06C7533B';
const EMERGENCY_SUBDAO_MULTISIG = '0xa29f61256e948f3fb707b4b3b138c5ccb9ef9888';
const BALLERS_MULTISIG_GAUNTLET = '0xf4a80929163c5179ca042e1b292f5efbbe3d89e6';
const DAO_MULTISIG = '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f';

const createRoleData = (grantee: string, target: string, actionIds: string[]): RoleData[] =>
  actionIds.map((actionId) => ({ role: actionId, grantee: grantee.toLowerCase(), target: target.toLowerCase() }));

export const roles: RoleData[] = flatten([
  createRoleData(BALLERS_MULTISIG_GAUNTLET, DAO_MULTISIG, [
    ComposableStablePoolV2.actionId('ComposableStablePool', 'setSwapFeePercentage(uint256)'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'startAmplificationParameterUpdate(uint256,uint256)'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'stopAmplificationParameterUpdate()'),
    StablePool.actionId('StablePool', 'setSwapFeePercentage(uint256)'),
    StablePool.actionId('StablePool', 'startAmplificationParameterUpdate(uint256,uint256)'),
    StablePool.actionId('StablePool', 'stopAmplificationParameterUpdate()'),
    '0x0693774dcda5e82a5b5f4255fe8bc7aa5f7ce39cd6b4f9986b116fc4af317450',
    '0x881bd2702150eafb9524fe01e983df0fb0e99eca758c1b3959e46a084cc1618b',
  ]),

  createRoleData(BLABS_OPS_MULTISIG, DAO_MULTISIG, [
    NoProtocolFeeLbp.actionId('NoProtocolFeeLiquidityBootstrappingPoolFactory', 'disable()'),
    AaveRebalancedLinearPool.actionId('AaveLinearPoolFactory', 'disable()'),
    ArbitrumRootGaugeFactoryV2.actionId('ArbitrumRootGaugeFactory', 'setArbitrumFees(uint64,uint64,uint64)'),
    ComposableStablePool.actionId('ComposableStablePoolFactory', 'disable()'),
    WeightedPoolV2.actionId('WeightedPoolFactory', 'disable()'),
    ManagedPool.actionId('ManagedPoolFactory', 'disable()'),
    ComposableStablePoolV2.actionId('ComposableStablePoolFactory', 'disable()'),
    PoolRecoveryHelper.actionId('PoolRecoveryHelper', 'addPoolFactory(address)'),
    PoolRecoveryHelper.actionId('PoolRecoveryHelper', 'removePoolFactory(address)'),
    '0x3924d0d790727bf2925421c7e316cfbe3d8b69f26b36b9d7d1c97e32bdeb4947',
  ]),

  createRoleData(EMERGENCY_SUBDAO_MULTISIG, DAO_MULTISIG, [
    StablePoolV2.actionId('StablePool', 'enableRecoveryMode()'),
    AaveRebalancedLinearPool.actionId('AaveLinearPool', 'enableRecoveryMode()'),
    AaveRebalancedLinearPool.actionId('AaveLinearPoolFactory', 'disable()'),
    ComposableStablePool.actionId('ComposableStablePool', 'enableRecoveryMode()'),
    ComposableStablePool.actionId('ComposableStablePoolFactory', 'disable()'),
    WeightedPoolV2.actionId('WeightedPool', 'enableRecoveryMode()'),
    WeightedPoolV2.actionId('WeightedPoolFactory', 'disable()'),
    ManagedPool.actionId('ManagedPool', 'enableRecoveryMode()'),
    ManagedPool.actionId('ManagedPoolFactory', 'disable()'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'pause()'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'unpause()'),
    ComposableStablePoolV2.actionId('ComposableStablePool', 'enableRecoveryMode()'),
    ComposableStablePoolV2.actionId('ComposableStablePoolFactory', 'disable()'),
    AaveRebalancedLinearPoolV3.actionId('AaveLinearPool', 'enableRecoveryMode()'),
    AaveRebalancedLinearPoolV3.actionId('AaveLinearPoolFactory', 'disable()'),
    '0x1f16abe3860c7a3426659e50f0217af96ac40aa554d8ddaebcb7c399118eeb1b',
    '0xcdd7ab46c8258e8c091144b92a3a1061315e0da3aef7773d859de4ee421fd920',
  ]),

  createRoleData(PoolRecoveryHelper.output().PoolRecoveryHelper, DAO_MULTISIG, [
    ComposableStablePool.actionId('ComposableStablePool', 'enableRecoveryMode()'),
    WeightedPoolV2.actionId('WeightedPool', 'enableRecoveryMode()'),
  ]),
]);
