import Task, { TaskMode } from '../../src/task';
import { MONTH } from '@balancer-labs/v2-helpers/src/time';

export type ERC4626LinearPoolDeployment = {
  Vault: string;
  BalancerQueries: string;
  ProtocolFeePercentagesProvider: string;
  WETH: string;
  FactoryVersion: string;
  PoolVersion: string;
  InitialPauseWindowDuration: number;
  BufferPeriodDuration: number;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const WETH = new Task('00000000-tokens', TaskMode.READ_ONLY);

const BaseVersion = { version: 3, deployment: '20230206-erc4626-linear-pool-v3' };

export default {
  Vault,
  BalancerQueries,
  ProtocolFeePercentagesProvider,
  WETH,
  FactoryVersion: JSON.stringify({ name: 'ERC4626LinearPoolFactory', ...BaseVersion }),
  PoolVersion: JSON.stringify({ name: 'ERC4626LinearPool', ...BaseVersion }),
  InitialPauseWindowDuration: MONTH * 3,
  BufferPeriodDuration: MONTH,
};
