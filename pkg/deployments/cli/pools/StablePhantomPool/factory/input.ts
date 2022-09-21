import Task, { TaskMode } from '../../../../src/task';

const StablePhantomPoolTask = new Task('20211208-stable-phantom-pool', TaskMode.READ_ONLY);

export default {
  StablePhantomPoolTask,
};
