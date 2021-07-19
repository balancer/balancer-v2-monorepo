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
