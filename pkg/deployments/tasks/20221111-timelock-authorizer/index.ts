import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { TimelockAuthorizerDeployment } from './input';

export default async (task: Task, { force, from, extra }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerDeployment;

  // TODO(@jubeira): remove extra; replace entrypoint with input
  const AuthorizerAdaptorEntrypoint = extra as string;

  const args = [
    input.Root,
    input.Authorizer,
    AuthorizerAdaptorEntrypoint,
    // input.AuthorizerAdaptorEntrypoint,
    input.Roles,
    input.Granters,
    input.Revokers,
    input.ExecuteDelays,
    input.GrantDelays,
    { gasLimit: 15e6 },
  ];
  const migrator = await task.deployAndVerify('TimelockAuthorizerMigrator', args, from, force);

  const authorizer = await task.instanceAt('TimelockAuthorizer', await migrator.newAuthorizer());
  const authorizerArgs = [migrator.address, AuthorizerAdaptorEntrypoint, await migrator.CHANGE_ROOT_DELAY()];

  await task.verify('TimelockAuthorizer', authorizer.address, authorizerArgs);
  task.save({ TimelockAuthorizer: authorizer });

  const executor = await task.instanceAt('TimelockExecutor', await authorizer.getExecutor());
  await task.verify('TimelockExecutor', executor.address, []);
};
