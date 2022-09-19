import Task, { TaskMode } from '../../src/task';

const MetaStablePoolTask = new Task('20210727-meta-stable-pool', TaskMode.READ_ONLY);

export default {
  MetaStablePoolTask,
};
