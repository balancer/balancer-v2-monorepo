import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import Task, { TaskMode } from '../../src/task';
import { BigNumber } from 'ethers';

export type ProtocolFeePercentagesProviderDeployment = {
  Vault: string;
  maxYieldValue: BigNumber;
  maxAUMValue: BigNumber;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const maxYieldValue = fp(0.5);
const maxAUMValue = fp(0.5);

export default {
  Vault,
  maxYieldValue,
  maxAUMValue,
};
