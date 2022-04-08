// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


// Mock of the DAI token to perform local test swaps
contract ERC20DAIMock is ERC20("DAIMock", "TDAI") {

    // main developers (founders) multi-sig wallet
    // 1 mln tokens
    address public founder;

    uint public constant AMOUNT_INIT = 1000000 * 1e18;

    constructor(address _founder) public {
        founder = _founder;	  //address that deployed contract becomes initial founder
	    _mint(founder, AMOUNT_INIT);
    }

    function burn(address _address, uint256 _amount) public {
        _burn(_address, _amount);
    }
}