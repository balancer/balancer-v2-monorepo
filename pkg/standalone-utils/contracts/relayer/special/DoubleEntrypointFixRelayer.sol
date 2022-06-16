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
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/pool-stable/StablePoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "hardhat/console.sol";

/**
 * @title DoubleEntrypointFixRelayer
 * @notice This contract performs mitigations to safeguard funds affected by double-entrypoint tokens (mostly Synthetix
 * tokens). It doesn't use the standard relayer architecture to simplify the code.
 */
contract DoubleEntrypointFixRelayer is IFlashLoanRecipient {
    using SafeERC20 for IERC20;

    IERC20 public constant BTC_STABLE_POOL_ADDRESS = IERC20(0xFeadd389a5c427952D8fdb8057D6C8ba1156cC56);
    bytes32 public constant BTC_STABLE_POOL_ID = 0xfeadd389a5c427952d8fdb8057d6c8ba1156cc56000000000000000000000066;
    IERC20 public constant wBTC = IERC20(0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599);
    IERC20 public constant renBTC = IERC20(0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D);
    IERC20 public constant sBTC = IERC20(0xfE18be6b3Bd88A2D2A7f928d00292E7a9963CfC6);
    IERC20 public constant sBTC_IMPLEMENTATION = IERC20(0x18FcC34bdEaaF9E3b69D2500343527c0c995b1d6);

    IERC20 public constant SNX_WEIGHTED_POOL_ADDRESS = IERC20(0x072f14B85ADd63488DDaD88f855Fda4A99d6aC9B);
    bytes32 public constant SNX_WEIGHTED_POOL_ID = 0x072f14b85add63488ddad88f855fda4a99d6ac9b000200000000000000000027;
    IERC20 public constant SNX = IERC20(0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F);
    IERC20 public constant WETH = IERC20(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    IERC20 public constant SNX_IMPLEMENTATION = IERC20(0x639032d3900875a4cf4960aD6b9ee441657aA93C);

    IVault private immutable _vault;
    IProtocolFeesCollector private immutable _protocolFeeCollector;

    constructor(IVault vault) {
        _vault = vault;
        _protocolFeeCollector = vault.getProtocolFeesCollector();
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    /**
     * @notice Fully exit the BTC Stable Pool into its three components (wBTC, renBTC and sBTC), with no price impact
     * nor swap fees. This relayer must have been previously approved by the caller, and proper permissions granted by
     * Balancer Governance.
     */
    function exitBTCStablePool() external {
        IERC20[] memory tokens = new IERC20[](3);
        tokens[0] = wBTC;
        tokens[1] = renBTC;
        tokens[2] = sBTC;
        uint256 bptAmountIn = BTC_STABLE_POOL_ADDRESS.balanceOf(msg.sender);

        // Pull sBTC out from the Protocol Fee Collector and send it to the Vault ready for the exit. Computing the
        // exact amount of sBTC required is a complicated task, as it involves due protocol fees, so we simply send all
        // of it.
        _withdrawFromProtocolFeeCollector(sBTC, sBTC.balanceOf(address(_protocolFeeCollector)));

        // Perform the exit.
        bytes memory userData = abi.encode(StablePoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptAmountIn);
        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest(
            _asIAsset(tokens),
            new uint256[](tokens.length),
            userData,
            false
        );
        getVault().exitPool(BTC_STABLE_POOL_ID, msg.sender, msg.sender, request);

        // Sweep any remaining sBTC back into the Protocol Fee Collector.
        IERC20[] memory sBTCEntrypoints = new IERC20[](2);
        sBTCEntrypoints[0] = sBTC_IMPLEMENTATION;
        sBTCEntrypoints[1] = IERC20(address(sBTC));
        sweepDoubleEntrypointToken(sBTCEntrypoints);
    }

    /**
     * @notice Fully exit the SNX Weighted Pool into its two components (SNX and WETH), with no price impact nor swap
     * fees. This relayer must have been previously approved by the caller, and proper permissions granted by
     * Balancer Governance.
     */
    function exitSNXWeightedPool() external {
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = SNX;
        tokens[1] = WETH;
        uint256 bptAmountIn = SNX_WEIGHTED_POOL_ADDRESS.balanceOf(msg.sender);

        // Pull SNX out from the Protocol Fee Collector and send it to the Vault ready for the exit. Computing the
        // exact amount of SNX required is a complicated task, as it involves due protocol fees, so we simply send all
        // of it.
        _withdrawFromProtocolFeeCollector(SNX, SNX.balanceOf(address(_protocolFeeCollector)));

        // Perform the exit.
        bytes memory userData = abi.encode(WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptAmountIn);
        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest(
            _asIAsset(tokens),
            new uint256[](tokens.length),
            userData,
            false
        );
        getVault().exitPool(SNX_WEIGHTED_POOL_ID, msg.sender, msg.sender, request);

        // Sweep any remaining SNX back into the Protocol Fee Collector.
        IERC20[] memory snxEntrypoints = new IERC20[](2);
        snxEntrypoints[0] = SNX_IMPLEMENTATION;
        snxEntrypoints[1] = IERC20(address(SNX));
        sweepDoubleEntrypointToken(snxEntrypoints);
    }

    function _withdrawFromProtocolFeeCollector(IERC20 token, uint256 amount) internal {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = token;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        _protocolFeeCollector.withdrawCollectedFees(tokens, amounts, address(_vault));
    }

    /**
     * @notice Sweep all SNX and sBTC from the Vault into the Protocol Fee Collector.
     */
    function sweepSNXsBTC() public {
        IERC20[] memory snxEntrypoints = new IERC20[](2);
        snxEntrypoints[0] = SNX_IMPLEMENTATION;
        snxEntrypoints[1] = IERC20(address(SNX));

        sweepDoubleEntrypointToken(snxEntrypoints);

        IERC20[] memory sBTCEntrypoints = new IERC20[](2);
        sBTCEntrypoints[0] = sBTC_IMPLEMENTATION;
        sBTCEntrypoints[1] = IERC20(address(sBTC));
        sweepDoubleEntrypointToken(sBTCEntrypoints);
    }

    /**
     * @notice Sweep a double-entrypoint token into the Protocol Fee Collector by passing all entrypoints of a given
     * token.
     */
    function sweepDoubleEntrypointToken(IERC20[] memory tokens) public {
        uint256[] memory amounts = new uint256[](tokens.length);
        amounts[0] = tokens[0].balanceOf(address(_vault));
        _vault.flashLoan(this, tokens, amounts, "0x");
    }

    /**
     * @dev Flash loan callback. Assumes that it receives a flashloan of multiple assets (all entrypoints of a Synthetix
     * synth). We only need to repay the first loan as that will automatically all other loans.
     */
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory,
        bytes memory
    ) external override {
        _require(msg.sender == address(_vault), Errors.CALLER_NOT_VAULT);
        tokens[0].safeTransfer(address(_vault), amounts[0]);
    }
}
