// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;

// solhint-disable

function _require(bool condition, uint256 errorCode) pure {
    if (!condition) _revert(errorCode);
}

function _revert(uint256 errorCode) pure {
    revert(Errors._toReason(errorCode));
}

library Errors {
    // Math
    uint256 internal constant ADD_OVERFLOW                                  = 0;
    uint256 internal constant SUB_OVERFLOW                                  = 1;
    uint256 internal constant SUB_UNDERFLOW                                 = 2;
    uint256 internal constant MUL_OVERFLOW                                  = 3;
    uint256 internal constant ZERO_DIVISION                                 = 4;
    uint256 internal constant ZERO_MOD                                      = 5;
    uint256 internal constant DIV_INTERNAL                                  = 6;
    uint256 internal constant X_OUT_OF_BOUNDS                               = 7;
    uint256 internal constant Y_OUT_OF_BOUNDS                               = 8;
    uint256 internal constant PRODUCT_OUT_OF_BOUNDS                         = 9;

    // Input
    uint256 internal constant OUT_OF_BOUNDS                                 = 100;
    uint256 internal constant UNSORTED_ARRAY                                = 101;
    uint256 internal constant UNSORTED_TOKENS                               = 102;
    uint256 internal constant INPUT_LENGTH_MISMATCH                         = 103;
    uint256 internal constant TOKEN_NOT_CONTRACT                            = 104;

    // Shared pools
    uint256 internal constant MIN_TOKENS                                    = 200;
    uint256 internal constant MAX_TOKENS                                    = 201;
    uint256 internal constant MAX_SWAP_FEE                                  = 202;
    uint256 internal constant MINIMUM_BPT                                   = 203;
    uint256 internal constant CALLER_NOT_VAULT                              = 204;
    uint256 internal constant UNINITIALIZED                                 = 205;
    uint256 internal constant BPT_IN_MAX_AMOUNT                             = 206;
    uint256 internal constant BPT_OUT_MIN_AMOUNT                            = 207;
    uint256 internal constant UNHANDLED_JOIN_KIND                           = 209;
    uint256 internal constant UNHANDLED_EXIT_KIND                           = 210;

    // Stable pool
    uint256 internal constant MIN_AMP                                       = 300;
    uint256 internal constant MAX_AMP                                       = 301;
    uint256 internal constant MIN_WEIGHT                                    = 302;
    uint256 internal constant MAX_STABLE_TOKENS                             = 303;

    // Weighted pool
    uint256 internal constant MAX_IN_RATIO                                  = 400;
    uint256 internal constant MAX_OUT_RATIO                                 = 401;
    uint256 internal constant MIN_BPT_IN_FOR_TOKEN_OUT                      = 402;
    uint256 internal constant MAX_OUT_BPT_FOR_TOKEN_IN                      = 403;

    // Lib
    uint256 internal constant REENTRANCY                                    = 500;
    uint256 internal constant SENDER_NOT_ALLOWED                            = 501;
    uint256 internal constant EMERGENCY_PERIOD_ON                           = 502;
    uint256 internal constant EMERGENCY_PERIOD_FINISHED                     = 503;
    uint256 internal constant MAX_EMERGENCY_PERIOD                          = 504;
    uint256 internal constant MAX_EMERGENCY_PERIOD_CHECK_EXT                = 505;
    uint256 internal constant INSUFFICIENT_BALANCE                          = 506;
    uint256 internal constant INSUFFICIENT_ALLOWANCE                        = 507;
    uint256 internal constant ERC20_TRANSFER_FROM_ZERO_ADDRESS              = 508;
    uint256 internal constant ERC20_TRANSFER_TO_ZERO_ADDRESS                = 509;
    uint256 internal constant ERC20_MINT_TO_ZERO_ADDRESS                    = 510;
    uint256 internal constant ERC20_BURN_FROM_ZERO_ADDRESS                  = 511;
    uint256 internal constant ERC20_APPROVE_FROM_ZERO_ADDRESS               = 512;
    uint256 internal constant ERC20_APPROVE_TO_ZERO_ADDRESS                 = 513;
    uint256 internal constant ERC20_TRANSFER_EXCEEDS_ALLOWANCE              = 514;
    uint256 internal constant ERC20_DECREASED_ALLOWANCE_BELOW_ZERO          = 515;
    uint256 internal constant ERC20_TRANSFER_EXCEEDS_BALANCE                = 516;
    uint256 internal constant ERC20_BURN_EXCEEDS_ALLOWANCE                  = 517;
    uint256 internal constant SAFE_ERC20_OP_DIDNT_SUCCEED                   = 518;
    uint256 internal constant SAFE_ERC20_CALL_FAILED                        = 519;
    uint256 internal constant SAFE_ERC20_APPROVE_NON_ZERO_ALLOWANCE         = 520;
    uint256 internal constant SAFE_ERC20_DECREASED_ALLOWANCE_BELOW_ZERO     = 521;
    uint256 internal constant ADDRESS_INSUFFICIENT_BALANCE                  = 522;
    uint256 internal constant ADDRESS_CANNOT_SEND_VALUE                     = 523;
    uint256 internal constant ADDRESS_INSUFFICIENT_BALANCE_CALL             = 524;
    uint256 internal constant ADDRESS_CALL_TO_NON_CONTRACT                  = 525;
    uint256 internal constant ADDRESS_STATIC_CALL_NOT_CONTRACT              = 526;
    uint256 internal constant ADDRESS_CALL_FAILED                           = 527;
    uint256 internal constant ADDRESS_STATIC_CALL_FAILED                    = 528;
    uint256 internal constant ADDRESS_STATIC_CALL_VALUE_FAILED              = 529;
    uint256 internal constant CREATE2_INSUFFICIENT_BALANCE                  = 530;
    uint256 internal constant CREATE2_BYTECODE_ZERO                         = 531;
    uint256 internal constant CREATE2_DEPLOY_FAILED                         = 532;
    uint256 internal constant SAFE_CAST_VALUE_CANT_FIT_128                  = 533;
    uint256 internal constant SAFE_CAST_VALUE_CANT_FIT_64                   = 534;
    uint256 internal constant SAFE_CAST_VALUE_CANT_FIT_32                   = 535;
    uint256 internal constant SAFE_CAST_VALUE_CANT_FIT_16                   = 536;
    uint256 internal constant SAFE_CAST_VALUE_CANT_FIT_8                    = 537;
    uint256 internal constant SAFE_CAST_VALUE_CANT_FIT_INT256               = 538;
    uint256 internal constant SAFE_CAST_VALUE_NOT_POSITIVE                  = 539;
    uint256 internal constant GRANT_SENDER_NOT_ADMIN                        = 540;
    uint256 internal constant REVOKE_SENDER_NOT_ADMIN                       = 541;
    uint256 internal constant RENOUNCE_SENDER_NOT_ALLOWED                   = 542;
    uint256 internal constant ENUMERABLE_NON_EXISTENT_KEY                   = 543;
    uint256 internal constant SET_ROLE_SENDER_NOT_ADMIN                     = 544;

    // Vault
    uint256 internal constant INVALID_POOL_ID                               = 600;
    uint256 internal constant CALLER_NOT_POOL                               = 601;
    uint256 internal constant EXIT_BELOW_MIN                                = 602;
    uint256 internal constant SENDER_NOT_ASSET_MANAGER                      = 603;
    uint256 internal constant INVALID_POST_LOAN_BALANCE                     = 604;
    uint256 internal constant USER_DOESNT_ALLOW_RELAYER                     = 605;
    uint256 internal constant JOIN_ABOVE_MAX                                = 606;
    uint256 internal constant SWAP_LIMIT 			                        = 607;
    uint256 internal constant SWAP_DEADLINE 			                    = 608;
    uint256 internal constant CANNOT_SWAP_SAME_TOKEN 			            = 609;
    uint256 internal constant UNKNOWN_AMOUNT_IN_FIRST_SWAP 		            = 610;
    uint256 internal constant MALCONSTRUCTED_MULTIHOP_SWAP 		            = 611;
    uint256 internal constant INTERNAL_BALANCE_OVERFLOW 		            = 612;
    uint256 internal constant INSUFFICIENT_INTERNAL_BALANCE 	            = 613;
    uint256 internal constant INVALID_ETH_INTERNAL_BALANCE 		            = 614;
    uint256 internal constant INSUFFICIENT_ETH 			                    = 615;
    uint256 internal constant UNALLOCATED_ETH 			                    = 616;
    uint256 internal constant ETH_TRANSFER 			                        = 617;
    uint256 internal constant INVALID_TOKEN 			                    = 618;
    uint256 internal constant TOKENS_MISMATCH 			                    = 619;
    uint256 internal constant TOKEN_NOT_REGISTERED 			                = 620;
    uint256 internal constant TOKEN_ALREADY_REGISTERED 			            = 621;
    uint256 internal constant TOKENS_ALREADY_SET 			                = 622;
    uint256 internal constant NONZERO_TOKEN_BALANCE 			            = 623;
    uint256 internal constant BALANCE_TOTAL_OVERFLOW 			            = 624;
    uint256 internal constant TOKENS_LENGTH_MUST_BE_2 			            = 625;
    uint256 internal constant INVALID_RELAYER                               = 626;
    uint256 internal constant INVALID_INTERNAL_BALANCE_ACCOUNT              = 627;

    // Fees
    uint256 internal constant SWAP_FEE_TOO_HIGH 			                = 700;
    uint256 internal constant FLASH_LOAN_FEE_TOO_HIGH 			            = 701;
    uint256 internal constant INSUFFICIENT_COLLECTED_FEES 		            = 702;

    function _toReason(uint256 code) internal pure returns (string memory) {
        // log10(MAX_UINT256) ≈ 78, considering 4 more chars for the identifier, it makes a maximum of 82 length strings
        uint256 CODE_MAX_LENGTH = 82;
        bytes memory reversed = new bytes(CODE_MAX_LENGTH);

        // Encode given error code to ascii
        uint256 i;
        for (i = 0; code != 0; i++) {
            uint256 remainder = code % 10;
            code = code / 10;
            reversed[i] = byte(uint8(48 + remainder));
        }

        // Store identifier: "BAL#"
        reversed[i++] = byte(uint8(35)); // #
        reversed[i++] = byte(uint8(76)); // L
        reversed[i++] = byte(uint8(65)); // A
        reversed[i] = byte(uint8(66));   // B

        // Reverse the bytes array
        bytes memory reason = new bytes(i + 1);
        for (uint256 j = 0; j <= i; j++) {
            reason[j] = reversed[i - j];
        }

        return string(reason);
    }
}
