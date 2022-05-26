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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptor.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeAdder.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeController.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerMinter.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerTokenAdmin.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGaugeFactory.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IBALTokenHolderFactory.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

// solhint-disable not-rely-on-time

/**
 * @dev The currently deployed Authorizer has a different interface relative to the Authorizer in the monorepo
 * for granting/revoking roles(referred to as permissions in the new Authorizer) and so we require a one-off interface
 */
interface ICurrentAuthorizer is IAuthorizer {
    // solhint-disable-next-line func-name-mixedcase
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);

    function grantRole(bytes32 role, address account) external;

    function revokeRole(bytes32 role, address account) external;
}

// https://vote.balancer.fi/#/proposal/0x9fe19c491cf90ed2e3ed9c15761c43d39fd1fb732a940aba8058ff69787ee90a
// solhint-disable-next-line contract-name-camelcase
contract veBALDeploymentCoordinator is ReentrancyGuard {
    IBalancerTokenAdmin private immutable _balancerTokenAdmin;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    IBalancerToken private immutable _balancerToken;
    IBalancerMinter private immutable _balancerMinter;
    IGaugeController private immutable _gaugeController;
    IGaugeAdder private immutable _gaugeAdder;
    ILiquidityGaugeFactory private immutable _ethereumGaugeFactory;
    ILiquidityGaugeFactory private immutable _singleRecipientGaugeFactory;
    IBALTokenHolderFactory private immutable _balTokenHolderFactory;

    address public lmCommitteeMultisig = 0xc38c5f97B34E175FFd35407fc91a937300E33860;

    // All of veBAL, Polygon and Arbitrum funds are temporarily sent to multisigs which will take care of distribution
    // until an automated system is setup.
    address public veBALGaugeRecipient = 0xd2EB7Bd802A7CA68d9AcD209bEc4E664A9abDD7b;
    address public polygonGaugeRecipient = 0xd2EB7Bd802A7CA68d9AcD209bEc4E664A9abDD7b;
    address public arbitrumGaugeRecipient = 0xd2EB7Bd802A7CA68d9AcD209bEc4E664A9abDD7b;

    enum DeploymentStage { PENDING, FIRST_STAGE_DONE, SECOND_STAGE_DONE, THIRD_STAGE_DONE }

    uint256 public firstStageActivationTime;
    uint256 public secondStageActivationTime;
    uint256 public thirdStageActivationTime;

    DeploymentStage private _currentDeploymentStage;
    uint256 private immutable _activationScheduledTime;
    uint256 private immutable _thirdStageDelay;

    uint256 public constant LM_COMMITTEE_WEIGHT = 10e16; // 10%
    uint256 public constant VEBAL_WEIGHT = 10e16; // 10%
    uint256 public constant ETHEREUM_WEIGHT = 56e16; // 56%
    uint256 public constant POLYGON_WEIGHT = 17e16; // 17%
    uint256 public constant ARBITRUM_WEIGHT = 7e16; // 7%

    constructor(
        IBalancerMinter balancerMinter,
        IAuthorizerAdaptor authorizerAdaptor,
        IGaugeAdder gaugeAdder,
        ILiquidityGaugeFactory ethereumGaugeFactory,
        ILiquidityGaugeFactory singleRecipientGaugeFactory,
        IBALTokenHolderFactory balTokenHolderFactory,
        uint256 activationScheduledTime,
        uint256 thirdStageDelay
    ) {
        _currentDeploymentStage = DeploymentStage.PENDING;

        IBalancerTokenAdmin balancerTokenAdmin = balancerMinter.getBalancerTokenAdmin();

        _balancerTokenAdmin = balancerTokenAdmin;
        _authorizerAdaptor = authorizerAdaptor;
        _balancerToken = balancerTokenAdmin.getBalancerToken();
        _balancerMinter = balancerMinter;
        _gaugeController = IGaugeController(balancerMinter.getGaugeController());
        _gaugeAdder = gaugeAdder;
        _ethereumGaugeFactory = ethereumGaugeFactory;
        _singleRecipientGaugeFactory = singleRecipientGaugeFactory;
        _balTokenHolderFactory = balTokenHolderFactory;

        _activationScheduledTime = activationScheduledTime;
        _thirdStageDelay = thirdStageDelay;
    }

    /**
     * @notice Returns the Balancer Vault.
     */
    function getVault() public view returns (IVault) {
        return getAuthorizerAdaptor().getVault();
    }

    /**
     * @notice Returns the Balancer Vault's current authorizer.
     */
    function getAuthorizer() public view returns (ICurrentAuthorizer) {
        return ICurrentAuthorizer(address(getVault().getAuthorizer()));
    }

    function getAuthorizerAdaptor() public view returns (IAuthorizerAdaptor) {
        return _authorizerAdaptor;
    }

    function getBalancerTokenAdmin() external view returns (IBalancerTokenAdmin) {
        return _balancerTokenAdmin;
    }

    function getBalancerMinter() external view returns (IBalancerMinter) {
        return _balancerMinter;
    }

    /**
     * @notice Returns the address of the Gauge Controller
     */
    function getGaugeController() external view returns (IGaugeController) {
        return _gaugeController;
    }

    function getCurrentDeploymentStage() external view returns (DeploymentStage) {
        return _currentDeploymentStage;
    }

    function getActivationScheduledTime() external view returns (uint256) {
        return _activationScheduledTime;
    }

    function getThirdStageDelay() external view returns (uint256) {
        return _thirdStageDelay;
    }

    function performFirstStage() external nonReentrant {
        // Check internal state
        require(block.timestamp >= _activationScheduledTime, "Not ready for activation");
        require(_currentDeploymentStage == DeploymentStage.PENDING, "First step already performed");

        // Check external state: we need admin permission on both the BAL token and the Authorizer
        ICurrentAuthorizer authorizer = getAuthorizer();
        require(_balancerToken.hasRole(_balancerToken.DEFAULT_ADMIN_ROLE(), address(this)), "Not BAL admin");
        require(authorizer.canPerform(bytes32(0), address(this), address(0)), "Not Authorizer admin");

        // Also require that Balancer governance holds all relevant admin rights
        IAuthorizerAdaptor authorizerAdaptor = getAuthorizerAdaptor();
        require(
            _gaugeController.voting_escrow().admin() == authorizerAdaptor,
            "VotingEscrow not owned by AuthorizerAdaptor"
        );
        require(_gaugeController.admin() == authorizerAdaptor, "GaugeController not owned by AuthorizerAdaptor");

        // Sanity checks
        require(_gaugeController.n_gauge_types() == 0, "Gauge types already set");

        // Step 1: trigger BAL token admin migration, locking the BAL emissions forever.
        //
        // The BalancerTokenAdmin contracts needs admin permission over BAL in order to complete this process, and we
        // need to be authorized to make the call.
        _balancerToken.grantRole(_balancerToken.DEFAULT_ADMIN_ROLE(), address(_balancerTokenAdmin));
        authorizer.grantRole(_balancerTokenAdmin.getActionId(IBalancerTokenAdmin.activate.selector), address(this));
        _balancerTokenAdmin.activate();
        // Balancer Token Admin activation automatically removes authority over the BAL token from all other accounts,
        // so we don't need to renounce this permission.

        // Step 2: grant BalancerMinter authority to mint BAL, as part of the Liquidity Mining program.
        authorizer.grantRole(
            _balancerTokenAdmin.getActionId(IBalancerTokenAdmin.mint.selector),
            address(_balancerMinter)
        );

        // Step 3: setup the Liquidity Mining program by creating the different gauge types on the Gauge Controller.
        //
        // All gauge types are initially created with a weight of 0, which will allow for gauges to be deployed and LPs
        // to vote and stake for them, without yet minting any BAL. This is intended to provide a grace period for LPs
        // to migrate to the new system before it is fully activated. The gauge type weights will be set to their actual
        // values on the last stage of deployment.
        {
            // Note that the current Authorizer ignores the 'where' parameter, so we don't need to (cannot) indicate
            // that this permission should only be granted on the gauge controller itself.
            authorizer.grantRole(authorizerAdaptor.getActionId(IGaugeController.add_type.selector), address(this));

            _addGaugeType("Liquidity Mining Committee");
            _addGaugeType("veBAL");
            _addGaugeType("Ethereum");
            _addGaugeType("Polygon");
            _addGaugeType("Arbitrum");

            authorizer.revokeRole(authorizerAdaptor.getActionId(IGaugeController.add_type.selector), address(this));
        }

        // Step 4: setup the GaugeAdder contract to be in charge of adding gauges to the Gauge Controller.
        //
        // The GaugeAdder contract performs checks on addresses being added to the Gauge Controller to ensure
        // that they have been deployed by a factory contract which has been associated with the gauge type
        // to which the proposed gauge is being added. This is intended to prevent common mistakes when adding gauges.

        authorizer.grantRole(authorizerAdaptor.getActionId(IGaugeController.add_gauge.selector), address(_gaugeAdder));

        // Step 5: create gauges for the single-recipient gauge types
        //
        // The LM committee gauge will be remain as a SingleRecipientGauge permanently,
        // however the gauges for veBAL, Polygon and Arbitrum types are temporary pending an automated solution.
        // These three gauges will in time be retired (killed) and replaced with new gauge implementations
        // which automate the distribution of BAL to BPT stakers on other networks and veBAL holders.
        {
            authorizer.grantRole(authorizerAdaptor.getActionId(IGaugeController.add_gauge.selector), address(this));

            // Permanent
            _createSingleRecipientGauge(
                IGaugeAdder.GaugeType.LiquidityMiningCommittee,
                "Liquidity Mining Committee BAL Holder",
                lmCommitteeMultisig
            );

            // Temporary
            _createSingleRecipientGauge(
                IGaugeAdder.GaugeType.veBAL,
                "Temporary veBAL Liquidity Mining BAL Holder",
                veBALGaugeRecipient
            );

            // Temporary
            _createSingleRecipientGauge(
                IGaugeAdder.GaugeType.Polygon,
                "Temporary Polygon Liquidity Mining BAL Holder",
                polygonGaugeRecipient
            );
            // Temporary
            _createSingleRecipientGauge(
                IGaugeAdder.GaugeType.Arbitrum,
                "Temporary Arbitrum Liquidity Mining BAL Holder",
                arbitrumGaugeRecipient
            );

            authorizer.revokeRole(authorizerAdaptor.getActionId(IGaugeController.add_gauge.selector), address(this));
        }

        // Step 6: grant permission to the LM Committee to add reward tokens to Ethereum gauges and manage their
        // distributors
        authorizer.grantRole(
            authorizerAdaptor.getActionId(IRewardTokenDistributor.add_reward.selector),
            lmCommitteeMultisig
        );

        authorizer.grantRole(
            authorizerAdaptor.getActionId(IRewardTokenDistributor.set_reward_distributor.selector),
            lmCommitteeMultisig
        );

        firstStageActivationTime = block.timestamp;
        _currentDeploymentStage = DeploymentStage.FIRST_STAGE_DONE;
    }

    function performSecondStage() external nonReentrant {
        require(_currentDeploymentStage == DeploymentStage.FIRST_STAGE_DONE, "Not ready for second stage");

        ICurrentAuthorizer authorizer = getAuthorizer();

        // Create gauges for a preselected list of pools on Ethereum. This is not included in the first stage to reduce
        // total required gas for the execution of each stage.

        address payable[32] memory initialPools = [
            0x06Df3b2bbB68adc8B0e302443692037ED9f91b42,
            0x072f14B85ADd63488DDaD88f855Fda4A99d6aC9B,
            0x0b09deA16768f0799065C475bE02919503cB2a35,
            0x186084fF790C65088BA694Df11758faE4943EE9E,
            0x1E19CF2D73a72Ef1332C882F20534B6519Be0276,
            0x27C9f71cC31464B906E0006d4FcBC8900F48f15f,
            0x32296969Ef14EB0c6d29669C550D4a0449130230,
            0x350196326AEAA9b98f1903fb5e8fc2686f85318C,
            0x3e5FA9518eA95c3E533EB377C001702A9AaCAA32,
            0x4bd6D86dEBdB9F5413e631Ad386c4427DC9D01B2,
            0x51735bdFBFE3fC13dEa8DC6502E2E95898942961,
            0x5d66FfF62c17D841935b60df5F07f6CF79Bd0F47,
            0x5f7FA48d765053F8dD85E052843e12D23e3D7BC5,
            0x702605F43471183158938C1a3e5f5A359d7b31ba,
            0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2,
            0x7Edde0CB05ED19e03A9a47CD5E53fC57FDe1c80c,
            0x8f4205e1604133d1875a3E771AE7e4F2b0865639,
            0x90291319F1D4eA3ad4dB0Dd8fe9E12BAF749E845,
            0x96646936b91d6B9D7D0c47C496AfBF3D6ec7B6f8,
            0x96bA9025311e2f47B840A1f68ED57A3DF1EA8747,
            0xa02E4b3d18D4E6B8d18Ac421fBc3dfFF8933c40a,
            0xA6F548DF93de924d73be7D25dC02554c6bD66dB5,
            0xBaeEC99c90E3420Ec6c1e7A769d2A856d2898e4D,
            0xBF96189Eee9357a95C7719f4F5047F76bdE804E5,
            0xe2469f47aB58cf9CF59F9822e3C5De4950a41C49,
            0xE99481DC77691d8E2456E5f3F61C1810adFC1503,
            0xeC60a5FeF79a92c741Cb74FdD6bfC340C0279B01,
            0xEdf085f65b4F6c155e13155502Ef925c9a756003,
            0xEFAa1604e82e1B3AF8430b90192c1B9e8197e377,
            0xF4C0DD9B82DA36C07605df83c8a416F11724d88b,
            0xf5aAf7Ee8C39B651CEBF5f1F50C10631E78e0ef9,
            0xFeadd389a5c427952D8fdb8057D6C8ba1156cC56
        ];

        // Allowlist the provided LiquidityGaugeFactory on the GaugeAdder
        // so its gauges may be added to the "Ethereum" gauge type.
        {
            authorizer.grantRole(_gaugeAdder.getActionId(IGaugeAdder.addGaugeFactory.selector), address(this));

            _gaugeAdder.addGaugeFactory(_ethereumGaugeFactory, IGaugeAdder.GaugeType.Ethereum);

            authorizer.revokeRole(_gaugeAdder.getActionId(IGaugeAdder.addGaugeFactory.selector), address(this));
        }

        // Deploy initial gauges and add them to the Gauge Controller
        {
            authorizer.grantRole(_gaugeAdder.getActionId(IGaugeAdder.addEthereumGauge.selector), address(this));

            uint256 poolsLength = initialPools.length;
            for (uint256 i = 0; i < poolsLength; i++) {
                ILiquidityGauge gauge = ILiquidityGauge(_ethereumGaugeFactory.create(initialPools[i]));
                _gaugeAdder.addEthereumGauge(IStakingLiquidityGauge(address(gauge)));
            }

            authorizer.revokeRole(_gaugeAdder.getActionId(IGaugeAdder.addEthereumGauge.selector), address(this));
        }

        secondStageActivationTime = block.timestamp;
        _currentDeploymentStage = DeploymentStage.SECOND_STAGE_DONE;
    }

    function performThirdStage() external nonReentrant {
        // Check delay from second stage
        require(_currentDeploymentStage == DeploymentStage.SECOND_STAGE_DONE, "Not ready for third stage");
        require(
            block.timestamp >= (secondStageActivationTime + _thirdStageDelay),
            "Delay from second stage not yet elapsed"
        );

        // We can now set the actual weights for each gauge type, causing gauges to have non-zero weights once veBAL
        // holders vote for them.
        // Admin functions on the Gauge Controller have to be called via the the AuthorizerAdaptor, which acts as its
        // admin.
        IAuthorizerAdaptor authorizerAdaptor = getAuthorizerAdaptor();
        // Note that the current Authorizer ignores the 'where' parameter, so we don't need to (cannot) indicate
        // that this permission should only be granted on the gauge controller itself.
        ICurrentAuthorizer authorizer = getAuthorizer();
        authorizer.grantRole(
            authorizerAdaptor.getActionId(IGaugeController.change_type_weight.selector),
            address(this)
        );

        _setGaugeTypeWeight(IGaugeAdder.GaugeType.LiquidityMiningCommittee, LM_COMMITTEE_WEIGHT);
        _setGaugeTypeWeight(IGaugeAdder.GaugeType.veBAL, VEBAL_WEIGHT);
        _setGaugeTypeWeight(IGaugeAdder.GaugeType.Ethereum, ETHEREUM_WEIGHT);
        _setGaugeTypeWeight(IGaugeAdder.GaugeType.Polygon, POLYGON_WEIGHT);
        _setGaugeTypeWeight(IGaugeAdder.GaugeType.Arbitrum, ARBITRUM_WEIGHT);

        authorizer.revokeRole(
            authorizerAdaptor.getActionId(IGaugeController.change_type_weight.selector),
            address(this)
        );

        // The entire system is now fully setup, and we can renounce permissions over the Authorizer
        authorizer.revokeRole(authorizer.DEFAULT_ADMIN_ROLE(), address(this));

        thirdStageActivationTime = block.timestamp;
        _currentDeploymentStage = DeploymentStage.THIRD_STAGE_DONE;
    }

    function _addGauge(ILiquidityGauge gauge, IGaugeAdder.GaugeType gaugeType) private {
        getAuthorizerAdaptor().performAction(
            address(_gaugeController),
            abi.encodeWithSelector(IGaugeController.add_gauge.selector, gauge, gaugeType)
        );
    }

    function _addGaugeType(string memory name) private {
        getAuthorizerAdaptor().performAction(
            address(_gaugeController),
            abi.encodeWithSelector(IGaugeController.add_type.selector, name, 0)
        );
    }

    function _setGaugeTypeWeight(IGaugeAdder.GaugeType typeId, uint256 weight) private {
        getAuthorizerAdaptor().performAction(
            address(_gaugeController),
            abi.encodeWithSelector(IGaugeController.change_type_weight.selector, int128(typeId), weight)
        );
    }

    function _createSingleRecipientGauge(
        IGaugeAdder.GaugeType gaugeType,
        string memory name,
        address recipient
    ) private {
        IBALTokenHolder holder = _balTokenHolderFactory.create(name);
        ILiquidityGauge gauge = ILiquidityGauge(_singleRecipientGaugeFactory.create(address(holder)));
        _addGauge(gauge, gaugeType);
        getAuthorizer().grantRole(holder.getActionId(IBALTokenHolder.withdrawFunds.selector), recipient);
    }
}
