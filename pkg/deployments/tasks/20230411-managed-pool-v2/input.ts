import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import Task, { TaskMode } from '../../src/task';

export type ManagedPoolDeployment = {
  Vault: string;
  ProtocolFeePercentagesProvider: string;
  FactoryVersion: string;
  PoolVersion: string;
  InitialPauseWindowDuration: number;
  BufferPeriodDuration: number;
  WETH: string;
  BAL: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const BaseVersion = { version: 2, deployment: '20230411-managed-pool-v2' };
const WETH = new Task('00000000-tokens', TaskMode.READ_ONLY);
const BAL = new Task('00000000-tokens', TaskMode.READ_ONLY);

// Since these pools have many experimental features, use a longer pause period.
const extendedPauseWindowDuration = MONTH * 9;

export default {
  Vault,
  ProtocolFeePercentagesProvider,
  FactoryVersion: JSON.stringify({ name: 'ManagedPoolFactory', ...BaseVersion }),
  PoolVersion: JSON.stringify({ name: 'ManagedPool', ...BaseVersion }),
  InitialPauseWindowDuration: extendedPauseWindowDuration,
  BufferPeriodDuration: MONTH,
  WETH,
  BAL,
};
