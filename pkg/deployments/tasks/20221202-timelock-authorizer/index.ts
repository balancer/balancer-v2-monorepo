import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { TimelockAuthorizerDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerDeployment;

  const args = [
    input.Root,
    input.Authorizer,
    input.AuthorizerAdaptorEntrypoint,
    input.Roles,
    input.Granters,
    input.Revokers,
    input.ExecuteDelays,
    input.GrantDelays,
  ];
  const migrator = await task.deployAndVerify('TimelockAuthorizerMigrator', args, from, force);

  const authorizer = await task.instanceAt('TimelockAuthorizer', await migrator.newAuthorizer());
  const authorizerArgs = [migrator.address, input.AuthorizerAdaptorEntrypoint, await migrator.CHANGE_ROOT_DELAY()];

  await task.verify('TimelockAuthorizer', authorizer.address, authorizerArgs);
  await task.save({ TimelockAuthorizer: authorizer });

  const executor = await task.instanceAt('TimelockExecutor', await authorizer.getExecutor());
  await task.verify('TimelockExecutor', executor.address, []);
};
