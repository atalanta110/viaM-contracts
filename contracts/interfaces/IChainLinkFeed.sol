// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

interface IChainLinkFeed {
  function latestAnswer() external view returns (int256);
}