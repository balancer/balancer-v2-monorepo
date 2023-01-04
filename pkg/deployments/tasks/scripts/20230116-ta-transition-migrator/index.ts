import Task from '../../../src/task';
import { TaskRunOptions } from '../../../src/types';
import { TimelockAuthorizerTransitionMigratorDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerTransitionMigratorDeployment;

  const roles = await input.Roles;

  const args = [input.OldAuthorizer, input.NewAuthorizer, roles];
  await task.deployAndVerify('TimelockAuthorizerTransitionMigrator', args, from, force);
};
