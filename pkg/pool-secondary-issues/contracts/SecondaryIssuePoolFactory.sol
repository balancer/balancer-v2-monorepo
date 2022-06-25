// Factory to create pools of secondary issues for security token offerings
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolSplitCodeFactory.sol";

import "./SecondaryIssuePool.sol";
import "./interfaces/ISecondaryIssuePoolFactory.sol";

contract SecondaryIssuePoolFactory is BasePoolSplitCodeFactory, FactoryWidePauseWindow {

    constructor(IVault vault) BasePoolSplitCodeFactory(vault, type(SecondaryIssuePool).creationCode) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create(
        string calldata _name,
        string calldata _symbol,
        address _security,
        address _currency,
        uint256 _maxAmountsIn,
        uint256 _tradeFeePercentage
    ) external returns (address) {
        
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();

        return
            _create(
                abi.encode(  
                    getVault(),
                    _name,
                    _symbol,
                    _security,
                    _currency,
                    _tradeFeePercentage,
                    _maxAmountsIn,
                    pauseWindowDuration,
                    bufferPeriodDuration,
                    msg.sender
                ));
    }

}