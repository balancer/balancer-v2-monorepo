// Factory to create pools of new issues for security token offerings
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolSplitCodeFactory.sol";

import "./PrimaryIssuePool.sol";
import "./interfaces/IPrimaryIssuePoolFactory.sol";

contract PrimaryIssuePoolFactory is BasePoolSplitCodeFactory, FactoryWidePauseWindow {

    constructor(IVault vault) BasePoolSplitCodeFactory(vault, type(PrimaryIssuePool).creationCode) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create(IPrimaryIssuePoolFactory.FactoryPoolParams memory params
                    ) external returns (address){

        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();
        
        return
            _create(
                abi.encode(
                    getVault(),
                    params.security,
                    params.currency,
                    params.minimumPrice,
                    params.basePrice,
                    params.maxAmountsIn,
                    params.issueFeePercentage,
                    pauseWindowDuration,
                    bufferPeriodDuration,
                    params.cutOffTime,
                    msg.sender
                )
            );
    }

}