pragma solidity 0.5.12;

interface IPoolGovernance {
    function setSwapFee(bytes32 poolID, uint256 swapFee) external;

    function setController(bytes32 poolID, address controller) external;

    function setPublicSwap(bytes32 poolID) external;

    function addInitialLiquidity(
        bytes32 poolID,
        address[] calldata initialTokens,
        uint256[] calldata amountsIn
    ) external;

    function addLiquidity(bytes32 poolID, uint256[] calldata amountsIn)
        external;

    function removeLiquidity(
        bytes32 poolID,
        address recipient,
        uint256[] calldata amountsOut
    ) external;

    function getTokenAmountsIn(
        bytes32 poolID,
        uint256 ratio,
        uint256[] calldata maxAmountsIn
    ) external returns (uint256[] memory);

    function getTokenAmountsOut(
        bytes32 poolID,
        uint256 ratio,
        uint256[] calldata minAmountsOut
    ) external returns (uint256[] memory);

    function getPoolTokenBalance(bytes32 poolID, address token)
        external
        view
        returns (uint256);

    function getPoolTokens(bytes32 poolID)
        external
        view
        returns (address[] memory);
}
