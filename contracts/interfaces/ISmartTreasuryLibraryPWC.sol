// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent PowerCard-related methods for Smart Treasury
interface ISmartTreasuryLibraryPWC {
    function getActiveNFTstakers() external returns (address[] memory stakers, uint256 length);
}


