import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { TimelockAuthorizerDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerDeployment;

  const args = [
    input.Vault,
    input.Root,
    input.Authorizer,
    input.Roles,
    input.Granters,
    input.Revokers,
    input.ExecuteDelays,
    input.GrantDelays,
  ];
  const migrator = await task.deployAndVerify('TimelockAuthorizerMigrator', args, from, force);

  const timelockAuthorizer = await migrator.newAuthorizer();
  const timelockAuthorizerArgs = [migrator.address, input.Vault, await migrator.CHANGE_ROOT_DELAY()];
  await task.verify('TimelockAuthorizer', timelockAuthorizer, timelockAuthorizerArgs);
  await task.save({ TimelockAuthorizer: timelockAuthorizer });
};
