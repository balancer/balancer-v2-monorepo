const balancerErrorCodes: Record<string, string> = {
  '000': 'ADD_OVERFLOW',
  '001': 'SUB_OVERFLOW',
  '002': 'SUB_UNDERFLOW',
  '003': 'MUL_OVERFLOW',
  '004': 'ZERO_DIVISION',
  '005': 'DIV_INTERNAL',
  '006': 'X_OUT_OF_BOUNDS',
  '007': 'Y_OUT_OF_BOUNDS',
  '008': 'PRODUCT_OUT_OF_BOUNDS',
  '009': 'INVALID_EXPONENT',
  '100': 'OUT_OF_BOUNDS',
  '101': 'UNSORTED_ARRAY',
  '102': 'UNSORTED_TOKENS',
  '103': 'INPUT_LENGTH_MISMATCH',
  '104': 'ZERO_TOKEN',
  '105': 'INSUFFICIENT_DATA',
  '200': 'MIN_TOKENS',
  '201': 'MAX_TOKENS',
  '202': 'MAX_SWAP_FEE_PERCENTAGE',
  '203': 'MIN_SWAP_FEE_PERCENTAGE',
  '204': 'MINIMUM_BPT',
  '205': 'CALLER_NOT_VAULT',
  '206': 'UNINITIALIZED',
  '207': 'BPT_IN_MAX_AMOUNT',
  '208': 'BPT_OUT_MIN_AMOUNT',
  '209': 'EXPIRED_PERMIT',
  '210': 'NOT_TWO_TOKENS',
  '211': 'DISABLED',
  '300': 'MIN_AMP',
  '301': 'MAX_AMP',
  '302': 'MIN_WEIGHT',
  '303': 'MAX_STABLE_TOKENS',
  '304': 'MAX_IN_RATIO',
  '305': 'MAX_OUT_RATIO',
  '306': 'MIN_BPT_IN_FOR_TOKEN_OUT',
  '307': 'MAX_OUT_BPT_FOR_TOKEN_IN',
  '308': 'NORMALIZED_WEIGHT_INVARIANT',
  '309': 'INVALID_TOKEN',
  '310': 'UNHANDLED_JOIN_KIND',
  '311': 'ZERO_INVARIANT',
  '312': 'ORACLE_INVALID_SECONDS_QUERY',
  '313': 'ORACLE_NOT_INITIALIZED',
  '314': 'ORACLE_QUERY_TOO_OLD',
  '315': 'ORACLE_INVALID_INDEX',
  '316': 'ORACLE_BAD_SECS',
  '317': 'AMP_END_TIME_TOO_CLOSE',
  '318': 'AMP_ONGOING_UPDATE',
  '319': 'AMP_RATE_TOO_HIGH',
  '320': 'AMP_NO_ONGOING_UPDATE',
  '321': 'STABLE_INVARIANT_DIDNT_CONVERGE',
  '322': 'STABLE_GET_BALANCE_DIDNT_CONVERGE',
  '323': 'RELAYER_NOT_CONTRACT',
  '324': 'BASE_POOL_RELAYER_NOT_CALLED',
  '325': 'REBALANCING_RELAYER_REENTERED',
  '326': 'GRADUAL_UPDATE_TIME_TRAVEL',
  '327': 'SWAPS_DISABLED',
  '328': 'CALLER_IS_NOT_LBP_OWNER',
  '329': 'PRICE_RATE_OVERFLOW',
  '330': 'INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED',
  '331': 'WEIGHT_CHANGE_TOO_FAST',
  '332': 'LOWER_GREATER_THAN_UPPER_TARGET',
  '333': 'UPPER_TARGET_TOO_HIGH',
  '334': 'UNHANDLED_BY_LINEAR_POOL',
  '335': 'OUT_OF_TARGET_RANGE',
  '336': 'UNHANDLED_EXIT_KIND',
  '337': 'UNAUTHORIZED_EXIT',
  '338': 'MAX_MANAGEMENT_SWAP_FEE_PERCENTAGE',
  '339': 'UNHANDLED_BY_MANAGED_POOL',
  '340': 'UNHANDLED_BY_PHANTOM_POOL',
  '341': 'TOKEN_DOES_NOT_HAVE_RATE_PROVIDER',
  '342': 'INVALID_INITIALIZATION',
  '343': 'OUT_OF_NEW_TARGET_RANGE',
  '344': 'FEATURE_DISABLED',
  '345': 'UNINITIALIZED_POOL_CONTROLLER',
  '346': 'SET_SWAP_FEE_DURING_FEE_CHANGE',
  '347': 'SET_SWAP_FEE_PENDING_FEE_CHANGE',
  '348': 'CHANGE_TOKENS_DURING_WEIGHT_CHANGE',
  '349': 'CHANGE_TOKENS_PENDING_WEIGHT_CHANGE',
  '350': 'MAX_WEIGHT',
  '351': 'UNAUTHORIZED_JOIN',
  '352': 'MAX_MANAGEMENT_AUM_FEE_PERCENTAGE',
  '353': 'FRACTIONAL_TARGET',
  '354': 'ADD_OR_REMOVE_BPT',
  '355': 'INVALID_CIRCUIT_BREAKER_BOUNDS',
  '356': 'CIRCUIT_BREAKER_TRIPPED',
  '357': 'MALICIOUS_QUERY_REVERT',
  '358': 'JOINS_EXITS_DISABLED',
  '400': 'REENTRANCY',
  '401': 'SENDER_NOT_ALLOWED',
  '402': 'PAUSED',
  '403': 'PAUSE_WINDOW_EXPIRED',
  '404': 'MAX_PAUSE_WINDOW_DURATION',
  '405': 'MAX_BUFFER_PERIOD_DURATION',
  '406': 'INSUFFICIENT_BALANCE',
  '407': 'INSUFFICIENT_ALLOWANCE',
  '408': 'ERC20_TRANSFER_FROM_ZERO_ADDRESS',
  '409': 'ERC20_TRANSFER_TO_ZERO_ADDRESS',
  '410': 'ERC20_MINT_TO_ZERO_ADDRESS',
  '411': 'ERC20_BURN_FROM_ZERO_ADDRESS',
  '412': 'ERC20_APPROVE_FROM_ZERO_ADDRESS',
  '413': 'ERC20_APPROVE_TO_ZERO_ADDRESS',
  '414': 'ERC20_TRANSFER_EXCEEDS_ALLOWANCE',
  '415': 'ERC20_DECREASED_ALLOWANCE_BELOW_ZERO',
  '416': 'ERC20_TRANSFER_EXCEEDS_BALANCE',
  '417': 'ERC20_BURN_EXCEEDS_ALLOWANCE',
  '418': 'SAFE_ERC20_CALL_FAILED',
  '419': 'ADDRESS_INSUFFICIENT_BALANCE',
  '420': 'ADDRESS_CANNOT_SEND_VALUE',
  '421': 'SAFE_CAST_VALUE_CANT_FIT_INT256',
  '422': 'GRANT_SENDER_NOT_ADMIN',
  '423': 'REVOKE_SENDER_NOT_ADMIN',
  '424': 'RENOUNCE_SENDER_NOT_ALLOWED',
  '425': 'BUFFER_PERIOD_EXPIRED',
  '426': 'CALLER_IS_NOT_OWNER',
  '427': 'NEW_OWNER_IS_ZERO',
  '428': 'CODE_DEPLOYMENT_FAILED',
  '429': 'CALL_TO_NON_CONTRACT',
  '430': 'LOW_LEVEL_CALL_FAILED',
  '431': 'NOT_PAUSED',
  '432': 'ADDRESS_ALREADY_ALLOWLISTED',
  '433': 'ADDRESS_NOT_ALLOWLISTED',
  '434': 'ERC20_BURN_EXCEEDS_BALANCE',
  '435': 'INVALID_OPERATION',
  '436': 'CODEC_OVERFLOW',
  '437': 'IN_RECOVERY_MODE',
  '438': 'NOT_IN_RECOVERY_MODE',
  '439': 'INDUCED_FAILURE',
  '440': 'EXPIRED_SIGNATURE',
  '441': 'MALFORMED_SIGNATURE',
  '442': 'SAFE_CAST_VALUE_CANT_FIT_UINT64',
  '443': 'UNHANDLED_FEE_TYPE',
  '444': 'BURN_FROM_ZERO',
  '445': 'VAULT_NOT_SET',
  '446': 'OWNABLE_UNAUTHORIZED_ACCOUNT',
  '447': 'OWNABLE_INVALID_OWNER',
  '448': 'POOL_ALREADY_IN_SET',
  '449': 'POOL_NOT_IN_SET',
  '450': 'SENDER_NOT_POOL_SET_MANAGER',
  '451': 'INVALID_POOL_SET_MANAGER',
  '452': 'POOL_SET_MANAGER_NOT_UNIQUE',
  '453': 'INVALID_POOL_SET_ID',
  '500': 'INVALID_POOL_ID',
  '501': 'CALLER_NOT_POOL',
  '502': 'SENDER_NOT_ASSET_MANAGER',
  '503': 'USER_DOESNT_ALLOW_RELAYER',
  '504': 'INVALID_SIGNATURE',
  '505': 'EXIT_BELOW_MIN',
  '506': 'JOIN_ABOVE_MAX',
  '507': 'SWAP_LIMIT',
  '508': 'SWAP_DEADLINE',
  '509': 'CANNOT_SWAP_SAME_TOKEN',
  '510': 'UNKNOWN_AMOUNT_IN_FIRST_SWAP',
  '511': 'MALCONSTRUCTED_MULTIHOP_SWAP',
  '512': 'INTERNAL_BALANCE_OVERFLOW',
  '513': 'INSUFFICIENT_INTERNAL_BALANCE',
  '514': 'INVALID_ETH_INTERNAL_BALANCE',
  '515': 'INVALID_POST_LOAN_BALANCE',
  '516': 'INSUFFICIENT_ETH',
  '517': 'UNALLOCATED_ETH',
  '518': 'ETH_TRANSFER',
  '519': 'CANNOT_USE_ETH_SENTINEL',
  '520': 'TOKENS_MISMATCH',
  '521': 'TOKEN_NOT_REGISTERED',
  '522': 'TOKEN_ALREADY_REGISTERED',
  '523': 'TOKENS_ALREADY_SET',
  '524': 'TOKENS_LENGTH_MUST_BE_2',
  '525': 'NONZERO_TOKEN_BALANCE',
  '526': 'BALANCE_TOTAL_OVERFLOW',
  '527': 'POOL_NO_TOKENS',
  '528': 'INSUFFICIENT_FLASH_LOAN_BALANCE',
  '600': 'SWAP_FEE_PERCENTAGE_TOO_HIGH',
  '601': 'FLASH_LOAN_FEE_PERCENTAGE_TOO_HIGH',
  '602': 'INSUFFICIENT_FLASH_LOAN_FEE_AMOUNT',
  '603': 'AUM_FEE_PERCENTAGE_TOO_HIGH',
  '700': 'SPLITTER_FEE_PERCENTAGE_TOO_HIGH',
  '998': 'UNIMPLEMENTED',
  '999': 'SHOULD_NOT_HAPPEN',
};

export class BalancerErrors {
  /**
   * Cannot be constructed.
   */
  private constructor() {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  }

  static isErrorCode = (error: string): boolean => {
    if (!error.includes('BAL#')) return false;

    const errorCode = error.replace('BAL#', '');
    return Object.keys(balancerErrorCodes).includes(errorCode);
  };

  /**
   * Decodes a Balancer error code into the corresponding reason
   * @param error - a Balancer error code of the form `BAL#000`
   * @returns The decoded error reason
   */
  static parseErrorCode = (error: string): string => {
    if (!error.includes('BAL#')) throw new Error('Error code not found');
    const errorCode = error.replace('BAL#', '');

    const actualError = balancerErrorCodes[errorCode];

    if (!actualError) throw new Error('Error code not found');

    return actualError;
  };

  /**
   * Decodes a Balancer error code into the corresponding reason
   * @param error - a Balancer error code of the form `BAL#000`
   * @returns The decoded error reason if passed a valid error code, otherwise returns passed input
   */
  static tryParseErrorCode = (error: string): string => {
    try {
      return BalancerErrors.parseErrorCode(error);
    } catch {
      return error;
    }
  };

  /**
   * Tests whether a string is a known Balancer error message
   * @param error - a string to be checked verified as a Balancer error message
   */
  static isBalancerError = (error: string): boolean => Object.values(balancerErrorCodes).includes(error);

  /**
   * Encodes an error string into the corresponding error code
   * @param error - a Balancer error message string
   * @returns a Balancer error code of the form `BAL#000`
   */
  static encodeError = (error: string): string => {
    const encodedError = Object.entries(balancerErrorCodes).find(([, message]) => message === error);

    if (!encodedError) throw Error('Error message not found');

    return `BAL#${encodedError[0]}`;
  };
}
