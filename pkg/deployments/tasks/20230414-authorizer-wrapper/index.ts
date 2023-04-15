import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { AuthorizerWithAdaptorValidationDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as AuthorizerWithAdaptorValidationDeployment;

  const authorizerArgs = [input.Authorizer, input.AuthorizerAdaptor, input.AuthorizerAdaptorEntrypoint];

  await task.deployAndVerify('AuthorizerWithAdaptorValidation', authorizerArgs, from, force);
};
