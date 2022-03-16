import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { TimelockAuthorizerDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerDeployment;
  const args = [input.Vault, input.Authorizer, input.rolesData];
  const migrator = await task.deployAndVerify('TimelockAuthorizerMigrator', args, from, force);
  const authorizer = await migrator.newAuthorizer();
  await task.save({ TimelockAuthorizer: authorizer });
};
