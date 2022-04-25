// Factory to create pools of new issues for security token offerings
//"SPDX-License-Identifier: MIT"

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolFactory.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";

import '@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol';
import '@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol';

import "./PrimaryIssuePool.sol";
import "./interfaces/IPrimaryIssuePoolFactory.sol";

contract PrimaryIssuePoolFactory is BasePoolFactory, FactoryWidePauseWindow {

    constructor(IVault vault) BasePoolFactory(vault) {
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
        
        address assetManager = msg.sender;
        address[] memory assetmanagers = new address[](2);
        assetmanagers[0] = assetManager;
        assetmanagers[1] = assetManager;

        PrimaryIssuePool.NewPoolParams memory poolparams = PrimaryIssuePool.NewPoolParams({
            vault: getVault(),
            name: ERC20(_security).name(),
            symbol: ERC20(_security).symbol(),
            security: IERC20(_security),
            currency: IERC20(_currency),
            assetManagers: assetmanagers,
            minimumPrice: _minimumPrice,
            basePrice: _basePrice,
            maxSecurityOffered : _maxAmountsIn,
            issueFeePercentage: _issueFeePercentage,
            pauseWindowDuration: pauseWindowDuration,
            bufferPeriodDuration: bufferPeriodDuration,
            issueCutoffTime: _cutOffTime,
            owner: assetManager
        });

        address pool = address(new PrimaryIssuePool(poolparams));
        _register(pool);
        return pool;
    }

}