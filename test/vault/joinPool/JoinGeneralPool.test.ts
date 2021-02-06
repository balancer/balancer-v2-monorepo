import { GeneralPool } from '../../../lib/helpers/pools';
import { describeJoinSpecializedPool } from './JoinPool.behavior';

describeJoinSpecializedPool(GeneralPool, 4);
