// contracts/mocks/PriceFeedMock.sol
pragma solidity 0.6.12;


import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IChainLinkFeed.sol";

// Mock of USDC/USD price feed
contract PriceFeedMock is IChainLinkFeed {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    function latestAnswer() public override view returns (int256) {
        // return static fixed value
        return 99991747;
    }
}