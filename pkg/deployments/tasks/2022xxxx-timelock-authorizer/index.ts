import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { TimelockAuthorizerDeployment } from './input';

import { DAY } from '@balancer-labs/v2-helpers/src/time';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as TimelockAuthorizerDeployment;
  const args = [input.Vault, input.root, input.Authorizer, input.rolesData];
  const migrator = await task.deployAndVerify('TimelockAuthorizerMigrator', args, from, force);
  const authorizer = await migrator.newAuthorizer();
  await task.verify('TimelockAuthorizer', authorizer.address, [migrator.address, input.Vault, 7 * DAY]);
  await task.save({ TimelockAuthorizer: authorizer });
};
