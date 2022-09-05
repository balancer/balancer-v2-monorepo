pragma solidity ^0.7.0;

library SecondaryPoolUserData {
    
    enum JoinKind {
        INIT
    }
    
    enum ExitKind {
        EMERGENCY_EXACT_BPT_IN_FOR_TOKENS_OUT
    }

    function joinKind(bytes memory self) internal pure returns (JoinKind) {
        return abi.decode(self, (JoinKind));
    }

    function exitKind(bytes memory self) internal pure returns (ExitKind) {
        return abi.decode(self, (ExitKind));
    }

    function exactBptInForTokensOut(bytes memory self) internal pure returns (uint256 bptAmountIn) {
        (, bptAmountIn) = abi.decode(self, (ExitKind, uint256));
    }
    
}