// Factory to create pools of new issues for security token offerings
//"SPDX-License-Identifier: MIT"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolFactory.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";

import "./PrimaryIssuePool.sol";
import "./interfaces/IPrimaryIssuePoolFactory.sol";

contract PrimaryIssuePoolFactory is BasePoolFactory, FactoryWidePauseWindow {

    constructor(IVault vault) BasePoolFactory(vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create(
        IPrimaryIssuePoolFactory.FactoryPoolParams memory params
    ) external returns (address) {
        
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();
        
        address assetManager = msg.sender;
        address[] memory assetmanagers = new address[](2);
        assetmanagers[0] = assetManager;
        assetmanagers[1] = assetManager;

        PrimaryIssuePool.NewPoolParams memory poolparams = PrimaryIssuePool.NewPoolParams({
            vault: getVault(),
            name: params.name,
            symbol: params.symbol,
            security: params.security,
            currency: params.currency,
            assetManagers: assetmanagers,
            minimumPrice: params.minimumPrice,
            basePrice: params.basePrice,
            maxSecurityOffered : params.maxAmountsIn,
            issueFeePercentage: params.issueFeePercentage,
            pauseWindowDuration: pauseWindowDuration,
            bufferPeriodDuration: bufferPeriodDuration,
            issueCutoffTime: params.cutOffTime,
            owner: assetManager
        });

        address pool = address(new PrimaryIssuePool(poolparams));
        _register(pool);
        return pool;
    }


}