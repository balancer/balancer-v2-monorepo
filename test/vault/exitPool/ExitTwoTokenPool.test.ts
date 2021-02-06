import { TwoTokenPool } from '../../../lib/helpers/pools';
import { describeExitSpecializedPool } from './ExitPool.behavior';

describeExitSpecializedPool(TwoTokenPool, 2);
