// Factory to create pools of new issues for security token offerings
// (c) Kallol Borah, 2022
//"SPDX-License-Identifier: BUSL1.1"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolSplitCodeFactory.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "./PrimaryIssuePool.sol";
import "./interfaces/IPrimaryIssuePoolFactory.sol";

contract PrimaryIssuePoolFactory is BasePoolSplitCodeFactory, FactoryWidePauseWindow {

    constructor(IVault vault) BasePoolSplitCodeFactory(vault, type(PrimaryIssuePool).creationCode) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create(address _security, 
                    address _currency, 
                    uint256 _minimumPrice,
                    uint256 _basePrice,
                    uint256 _maxAmountsIn,
                    uint256 _issueFeePercentage,
                    uint256 _cutOffTime
                    ) external returns (address){

        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();
        
        return
            _create(
                abi.encode(
                    getVault(),
                    _security,
                    _currency,
                    _minimumPrice,
                    _basePrice,
                    _maxAmountsIn,
                    _issueFeePercentage,
                    pauseWindowDuration,
                    bufferPeriodDuration,
                    _cutOffTime,
                    msg.sender
                ));

    }

}