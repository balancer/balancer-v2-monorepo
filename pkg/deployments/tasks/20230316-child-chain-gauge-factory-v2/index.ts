import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { ChildChainLiquidityGaugeFactoryDeployment } from './input';

export type ExtraInputs = {
  VotingEscrowDelegationProxy: string;
  L2BalancerPseudoMinter: string;
};

export default async (task: Task, { force, from, extra }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as ChildChainLiquidityGaugeFactoryDeployment;

  // TODO: remove extra, replace with inputs.
  input.VotingEscrowDelegationProxy = (extra as ExtraInputs).VotingEscrowDelegationProxy;
  input.L2BalancerPseudoMinter = (extra as ExtraInputs).L2BalancerPseudoMinter;

  const gaugeArgs = [
    input.VotingEscrowDelegationProxy,
    input.L2BalancerPseudoMinter,
    input.AuthorizerAdaptor,
    input.ProductVersion,
  ];

  // ChildChainGauge is written in Vyper, so we only deploy.
  const gaugeImplementation = await task.deploy('ChildChainGauge', gaugeArgs, from, force);

  const factoryArgs = [gaugeImplementation.address, input.FactoryVersion, input.ProductVersion];
  await task.deployAndVerify('ChildChainGaugeFactory', factoryArgs, from, force);
};
