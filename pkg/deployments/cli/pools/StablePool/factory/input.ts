import Task, { TaskMode } from '../../../../src/task';

const StablePoolTask = new Task('20210624-stable-pool', TaskMode.READ_ONLY);

export default {
  StablePoolTask,
};
