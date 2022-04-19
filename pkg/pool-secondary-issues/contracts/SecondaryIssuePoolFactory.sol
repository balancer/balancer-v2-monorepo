// Factory to create pools of secondary issues for security token offerings
//"SPDX-License-Identifier: MIT"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolFactory.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";

import "./SecondaryIssuePool.sol";
import "./interfaces/ISecondaryIssuePoolFactory.sol";

contract SecondaryIssuePoolFactory is BasePoolFactory, FactoryWidePauseWindow {

    constructor(IVault vault) BasePoolFactory(vault) {
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

        address assetManager = msg.sender;
        address[] memory assetmanagers = new address[](2);
        assetmanagers[0] = assetManager;
        assetmanagers[1] = assetManager;
        
        SecondaryIssuePool.NewPoolParams memory poolparams = SecondaryIssuePool.NewPoolParams({
            vault: getVault(),
            name: _name,
            symbol: _symbol,
            security: _security,
            currency: _currency,
            assetManagers: assetmanagers,
            tradeFeePercentage: _tradeFeePercentage,
            maxSecurityOffered : _maxAmountsIn,
            pauseWindowDuration: pauseWindowDuration,
            bufferPeriodDuration: bufferPeriodDuration,
            owner: msg.sender
        });

        address pool = address(new SecondaryIssuePool(poolparams));
        _register(pool);
        return pool;
    }


}