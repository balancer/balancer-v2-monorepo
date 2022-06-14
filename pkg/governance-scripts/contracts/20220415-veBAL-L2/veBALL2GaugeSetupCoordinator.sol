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
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ISingleRecipientGaugeFactory.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakelessGauge.sol";
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
contract veBALL2GaugeSetupCoordinator is ReentrancyGuard {
    IVault private immutable _vault;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    IVotingEscrow private immutable _votingEscrow;
    IGaugeController private immutable _gaugeController;
    IGaugeAdder private immutable _gaugeAdder;
    ILiquidityGaugeFactory private immutable _ethereumGaugeFactory;
    ISingleRecipientGaugeFactory private immutable _polygonGaugeFactory;
    ISingleRecipientGaugeFactory private immutable _arbitrumGaugeFactory;

    // solhint-disable-next-line var-name-mixedcase
    address public immutable GAUGE_CHECKPOINTER_MULTISIG = 0x02f35dA6A02017154367Bc4d47bb6c7D06C7533B;

    enum DeploymentStage { PENDING, FIRST_STAGE_DONE, SECOND_STAGE_DONE }

    uint256 public firstStageActivationTime;
    uint256 public secondStageActivationTime;

    DeploymentStage private _currentDeploymentStage;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IVotingEscrow votingEscrow,
        IGaugeAdder gaugeAdder,
        ILiquidityGaugeFactory ethereumGaugeFactory,
        ISingleRecipientGaugeFactory polygonGaugeFactory,
        ISingleRecipientGaugeFactory arbitrumGaugeFactory
    ) {
        _currentDeploymentStage = DeploymentStage.PENDING;

        IVault vault = authorizerAdaptor.getVault();
        _vault = vault;
        _authorizerAdaptor = authorizerAdaptor;
        _votingEscrow = votingEscrow;
        _gaugeController = gaugeAdder.getGaugeController();
        _gaugeAdder = gaugeAdder;
        _ethereumGaugeFactory = ethereumGaugeFactory;
        _polygonGaugeFactory = polygonGaugeFactory;
        _arbitrumGaugeFactory = arbitrumGaugeFactory;
    }

    /**
     * @notice Returns the Balancer Vault.
     */
    function getVault() public view returns (IVault) {
        return _vault;
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

    function getCurrentDeploymentStage() external view returns (DeploymentStage) {
        return _currentDeploymentStage;
    }

    function performFirstStage() external nonReentrant {
        // Check internal state
        require(_currentDeploymentStage == DeploymentStage.PENDING, "First step already performed");

        // Check external state: we need admin permission on the Authorizer
        ICurrentAuthorizer authorizer = getAuthorizer();
        require(authorizer.canPerform(bytes32(0), address(this), address(0)), "Not Authorizer admin");

        // Step 1: Allow multisig to checkpoint Polygon and Arbitrum gauges.
        _addGaugeCheckpointerMultisig();

        // Step 2: Add new gauges to the GaugeController.
        _addNewEthereumGauges();

        // Step 3: Deploy Arbitrum gauges and add them to the Gauge Controller.
        _addNewArbitrumGauges();

        // The following steps are performed in a separate stage to reduce the gas cost of the execution of each step.

        firstStageActivationTime = block.timestamp;
        _currentDeploymentStage = DeploymentStage.FIRST_STAGE_DONE;
    }

    function performSecondStage() external nonReentrant {
        // Check internal state
        require(_currentDeploymentStage == DeploymentStage.FIRST_STAGE_DONE, "Not ready for second stage");

        // Check external state: we need admin permission on the Authorizer
        ICurrentAuthorizer authorizer = getAuthorizer();
        require(authorizer.canPerform(bytes32(0), address(this), address(0)), "Not Authorizer admin");

        // Step 4: Deploy Polygon gauges and add them to the Gauge Controller.
        _addNewPolygonGauges();

        // Step 5: Kill deprecated Polygon and Arbitrum gauges.
        _deprecateOldGauges();

        // Step 6: Renounce admin role over the Authorizer.
        authorizer.revokeRole(bytes32(0), address(this));

        secondStageActivationTime = block.timestamp;
        _currentDeploymentStage = DeploymentStage.SECOND_STAGE_DONE;
    }

    function _addGaugeCheckpointerMultisig() private {
        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 checkpointGaugeRole = _authorizerAdaptor.getActionId(IStakelessGauge.checkpoint.selector);
        authorizer.grantRole(checkpointGaugeRole, GAUGE_CHECKPOINTER_MULTISIG);
    }

    function _addNewEthereumGauges() private {
        // All these addresses are required to be mainnet gauges which have already been deployed
        address payable[3] memory newGauges = [
            0xa57453737849A4029325dfAb3F6034656644E104, // 80HAUS-20WETH
            0xA6468eca7633246Dcb24E5599681767D27d1F978, // 50COW-50GNO
            0x158772F59Fe0d3b75805fC11139b46CBc89F70e5 // 50COW-50WETH
            // 80NOTE-20WETH may be eligible to be added here as well soon
        ];

        ICurrentAuthorizer authorizer = getAuthorizer();
        bytes32 addEthereumGaugeRole = _gaugeAdder.getActionId(IGaugeAdder.addEthereumGauge.selector);

        authorizer.grantRole(addEthereumGaugeRole, address(this));

        uint256 gaugesLength = newGauges.length;
        for (uint256 i = 0; i < gaugesLength; i++) {
            _gaugeAdder.addEthereumGauge(IStakingLiquidityGauge(newGauges[i]));
        }

        authorizer.revokeRole(addEthereumGaugeRole, address(this));
    }

    function _addNewPolygonGauges() private {
        // All these addresses are required to match ChildChainStreamers which have been deployed to Polygon mainnet.
        address payable[19] memory initialRecipients = [
            // Streamer                                 // Pool
            0x0FC855f77cE75Bb6a5d650D0c4cC92E460c03E25, // 0x0297e37f1873d2dab4487aa67cd56b58e2f27875
            0x4b878e9727B9E91fDaE37CdD85949f4367220187, // 0x03cd191f589d12b0582a99808cf19851e468e6b5
            0x66750473cE1dECBa4ef2576a47fd5FF7BF07C4e2, // 0x06df3b2bbb68adc8b0e302443692037ed9f91b42
            0x2Ac595007563df473449005883F1F2BA3036eBeF, // 0x0d34e5dd4d8f043557145598e4e2dc286b35fd4f
            0x3b4D173601F8b36024cD49F7C5859D263385AF34, // 0x10f21c9bd8128a29aa785ab2de0d044dcdd79436
            0xDe2F58c43CB222725A96236272c7749E4Abf1a25, // 0x186084ff790c65088ba694df11758fae4943ee9e
            0x73CF9C065bFB9ABf76d94787324CfC4F751ac097, // 0x36128d5436d2d70cab39c9af9cce146c38554ff0
            0x2845E95D2a4eFcd14Cf5D77B9Ba732788b96267f, // 0x5a6ae1fd70d04ba4a279fc219dfabc53825cb01d
            0xb061F502d84f00d1B26568888A8f741cBE352C23, // 0x614b5038611729ed49e0ded154d8a5d3af9d1d9e
            0xD65F35e750d5FFB63a3B6C7B4e5D4afe4CA5550D, // 0x7c9cf12d783821d5c63d8e9427af5c44bad92445
            0x25a526ADb6925a9f40141567C06430D368232FEE, // 0x805ca3ccc61cc231851dee2da6aabff0a7714aa7
            0x0fD7e9171b4dC9D89E157c2cc9A424Cd9C40a034, // 0xaf5e0b5425de1f5a630a8cb5aa9d97b8141c908d
            0xbc9F244cf5a774785E726A9157aFe3725d93249B, // 0xb204bf10bc3a5435017d3db247f56da601dfe08a
            0x2CCc518B7B6177C2d44771d6b249F85a5A0cC1D4, // 0xc31a37105b94ab4efca1954a14f059af11fcd9bb
            0x64AFDb69C22971B2ed289020f78a47E070cFadba, // 0xce66904b68f1f070332cbc631de7ee98b650b499
            0x6F4d27730d5253148d82283E3aD93eae9264DaA3, // 0xcf354603a9aebd2ff9f33e1b04246d8ea204ae95
            0x6812162860fAC498fB6f03339D39d23b5a264152, // 0xdb1db6e248d7bb4175f6e5a382d0a03fe3dcc813
            0x5EA9C37A3eCf0c82900FbbFd064FE29A427c41AB, // 0xea4e073c8ac859f2994c07e627178719c8002dc0
            0xA95E0B91A3F522dDE42D5b6a4e430e0BFAD0F2F5 // 0xfeadd389a5c427952d8fdb8057d6c8ba1156cc56
        ];

        ICurrentAuthorizer authorizer = getAuthorizer();

        bytes32 addGaugeFactoryRole = _gaugeAdder.getActionId(IGaugeAdder.addGaugeFactory.selector);
        bytes32 addPolygonGaugeRole = _gaugeAdder.getActionId(IGaugeAdder.addPolygonGauge.selector);

        // As these are the first polygon gauges we need to allowlist the factory in order to add them.
        authorizer.grantRole(addGaugeFactoryRole, address(this));
        _gaugeAdder.addGaugeFactory(_polygonGaugeFactory, IGaugeAdder.GaugeType.Polygon);
        authorizer.revokeRole(addGaugeFactoryRole, address(this));

        authorizer.grantRole(addPolygonGaugeRole, address(this));

        uint256 initialRecipientsLength = initialRecipients.length;
        for (uint256 i = 0; i < initialRecipientsLength; i++) {
            address gauge = _deployGauge(_polygonGaugeFactory, initialRecipients[i]);
            _gaugeAdder.addPolygonGauge(gauge);
        }

        authorizer.revokeRole(addPolygonGaugeRole, address(this));
    }

    function _addNewArbitrumGauges() private {
        // All these addresses are required to match ChildChainStreamers which have been deployed to Arbitrum One.
        address payable[14] memory initialRecipients = [
            // Streamer                                 // Pool
            0xD84d832F47C22Cf5413aE4FE2bd9D220FE6E3Dc6, // 0x0510ccf9eb3ab03c1508d3b9769e8ee2cfd6fdcf
            0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2, // 0x0adeb25cb5920d4f7447af4a0428072edc2cee22
            0x7C1028Bcde7Ca03EcF6DaAA9cBfA06E931913EaD, // 0x1533a3278f3f9141d5f820a184ea4b017fce2382
            0xa57eaBc36A47dae5F11051c8339385cF95E77235, // 0x1779900c7707885720d39aa741f4086886307e9e
            0x37A6FC079cad790E556BaeddA879358e076EF1B3, // 0x4a3a22a3e7fee0ffbb66f1c28bfac50f75546fc7
            0xB556A02642A0f7be8c79932EFBC915F6e0485147, // 0x5a5884fc31948d59df2aeccca143de900d49e1a3
            0x4B1137789FF06406a72bAce67Cd15Cf6786844cC, // 0x64541216bafffeec8ea535bb71fbc927831d0595
            0xBd65449BabF09Be544d68fc7CCF0CEbe298fb214, // 0x651e00ffd5ecfa7f3d4f33d62ede0a97cf62ede2
            0x2246211E715b6567a8F7138180EF61a79678ef46, // 0xb28670b3e7ad27bd41fb5938136bf9e9cba90d65
            0xf2Bbfa122D41fFcF7056441578D108E3c40a7E99, // 0xb340b6b1a34019853cb05b2de6ee8ffd0b89a008
            0xf081862BF62C24E3C708BdBeda24ABE6B55E42f7, // 0xb5b77f1ad2b520df01612399258e7787af63025d
            0x28Cc04DcD85C4b40c6Dad463c628e98728ae9496, // 0xc2f082d33b5b8ef3a7e3de30da54efd3114512ac
            0xDC467DB6AbdA75E62F4809f3a4934ae3aca1C380, // 0xc61ff48f94d801c1ceface0289085197b5ec44f0
            0xd5Cd8328D93bf4bEf9824Fd288F32C8f0da1c551 // 0xcc65a812ce382ab909a11e434dbf75b34f1cc59d
        ];

        ICurrentAuthorizer authorizer = getAuthorizer();

        bytes32 addGaugeFactoryRole = _gaugeAdder.getActionId(IGaugeAdder.addGaugeFactory.selector);
        bytes32 addArbitrumGaugeRole = _gaugeAdder.getActionId(IGaugeAdder.addArbitrumGauge.selector);

        // As these are the first arbitrum gauges we need to allowlist the factory in order to add them.
        authorizer.grantRole(addGaugeFactoryRole, address(this));
        _gaugeAdder.addGaugeFactory(_arbitrumGaugeFactory, IGaugeAdder.GaugeType.Arbitrum);
        authorizer.revokeRole(addGaugeFactoryRole, address(this));

        authorizer.grantRole(addArbitrumGaugeRole, address(this));

        uint256 initialRecipientsLength = initialRecipients.length;
        for (uint256 i = 0; i < initialRecipientsLength; i++) {
            address gauge = _deployGauge(_arbitrumGaugeFactory, initialRecipients[i]);
            _gaugeAdder.addArbitrumGauge(gauge);
        }

        authorizer.revokeRole(addArbitrumGaugeRole, address(this));
    }

    function _deprecateOldGauges() private {
        address payable[2] memory deprecatedGauges = [
            0x9fb8312CEdFB9b35364FF06311B429a2f4Cdf422, // Temporary Polygon gauge
            0x3F829a8303455CB36B7Bcf3D1bdc18D5F6946aeA // Temporary Arbitrum gauge
        ];

        ICurrentAuthorizer authorizer = getAuthorizer();

        bytes32 killGaugeRole = _authorizerAdaptor.getActionId(ILiquidityGauge.killGauge.selector);

        authorizer.grantRole(killGaugeRole, address(this));

        uint256 deprecatedGaugesLength = deprecatedGauges.length;
        for (uint256 i = 0; i < deprecatedGaugesLength; i++) {
            _killGauge(deprecatedGauges[i]);
        }

        authorizer.revokeRole(killGaugeRole, address(this));
    }

    function _deployGauge(ISingleRecipientGaugeFactory factory, address recipient) private returns (address gauge) {
        // Find gauge which distributes BAL to listed recipient
        gauge = address(factory.getRecipientGauge(recipient));
        if (gauge == address(0)) {
            // If gauge doesn't exist yet then create one.
            gauge = factory.create(recipient);
        }
    }

    function _killGauge(address gauge) private {
        getAuthorizerAdaptor().performAction(gauge, abi.encodeWithSelector(ILiquidityGauge.killGauge.selector));
    }

    function _setGaugeTypeWeight(IGaugeAdder.GaugeType typeId, uint256 weight) private {
        getAuthorizerAdaptor().performAction(
            address(_gaugeController),
            abi.encodeWithSelector(IGaugeController.change_type_weight.selector, int128(typeId), weight)
        );
    }
}
