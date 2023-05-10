import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { TimelockAuthorizerDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerDeployment;
  const migrator = await task.deployAndVerify(
    'TimelockAuthorizerMigrator',
    [
      input.Root,
      input.Authorizer,
      input.AuthorizerAdaptorEntrypoint,
      await input.getRoles(),
      input.Granters,
      input.Revokers,
      input.ExecuteDelays,
      input.GrantDelays,
    ],
    from,
    force
  );

  const authorizer = await task.instanceAt('TimelockAuthorizer', await migrator.newAuthorizer());
  const authorizerArgs = [
    migrator.address,
    input.Root,
    input.AuthorizerAdaptorEntrypoint,
    await migrator.CHANGE_ROOT_DELAY(),
  ];

  await task.verify('TimelockAuthorizer', authorizer.address, authorizerArgs);
  task.save({ TimelockAuthorizer: authorizer });

  const executor = await task.instanceAt('TimelockExecutionHelper', await authorizer.getTimelockExecutionHelper());
  await task.verify('TimelockExecutionHelper', executor.address, []);
};
