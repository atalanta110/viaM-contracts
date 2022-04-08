// File: contracts/interfaces/IUniswapRouterV2Minimal.sol
// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12;

// used by ST contract to auto-harvest sushi as USDC
interface IUniswapV2Router02Minimal {
    //function factory() external pure returns (address);
    //function WETH() external pure returns (address);
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}
