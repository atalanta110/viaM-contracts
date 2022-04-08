![](https://cdn-images-1.medium.com/max/1600/1*YBk2Kxe95-DI_5tZv0-YqQ.png)
## Mover — DeFi neobanking service.

Mover makes the internet economy easy and available to everyone. The app abstracts blockchain complexity so that you can finally get great financial service with all DeFi benefits. You can earn highest and safest yield on your digital assets with our automatic portfolio management system. You can also send, receive and swap 30000+ digital assets on Ethereum.


## New Deployed Contracts

These contracts are currently used in Mover V2.

[MOVEToken](https://etherscan.io/address/0x3FA729B4548beCBAd4EaB6EF18413470e6D5324C) - The Mover token

[HolyPassage](https://etherscan.io/address/0x39ac24FD08991B1d69A9ef7189Bc718C988fF5B3) - Migration and bonus tokens claim contract

[HolyVisor](https://etherscan.io/address/0x636356f857f89AF15Cb67735b68B9b673b5Cda6c) - Bonus multiplier oracle contract.

[HolyHand](https://etherscan.io/address/0x1eF7A557cfA8436ee08790e3F2b190b8937fDa0E) - Central token transfer proxy contract.

[HolyWing](https://etherscan.io/address/0xD5b3230ea9bF7baD9541F8564fA2FA72b350427B) - Token exchange proxy contract.

[HolyPool](https://etherscan.io/address/0xAF985437DCA19DEFf89e61F83Cd526b272523719) - Asset pool contract.

[HolyValor](https://etherscan.io/address/0xAF985437DCA19DEFf89e61F83Cd526b272523719) - Funds managing strategy contract.

[HolyRedeemer](https://etherscan.io/address/0x496599b4dE503D5C5C11882501af64d04025c6Dd) - Yield harvesting and distributor contract.

[SmartTreasury](https://etherscan.io/address/0x94f748bfd1483750a7df01acd993213ab64c960f) - mUSDC and Smart Treasury management contract.

[UnexpectedMove](https://etherscan.io/address/0x0769747d4cac06bc2320e0bb1efb31d53fa0aaa1) - Unexpected Mover (MOVERNFT1) NFT contract.

[SweetAndSour](https://etherscan.io/address/0x129b9083a9f02aed65e31644a8103d5aa2c73701) - Sweet And Sour (SAS) NFT contract.

## Previously Deployed Contracts

These contracts have been deployed previously, and are now no longer in use. 

[HolyToken](https://etherscan.io/token/0x39eae99e685906ff1c11a962a743440d0a1a6e09) - The Holyheld token

[HolyKnight](https://etherscan.io/address/0x5D33dE3E540b289f9340D059907ED648c9E7AaDD) - Holy Knight, contract to manage the LP staking

[HolderTVLLock](https://etherscan.io/address/0xe292dc1095b96809913bc00ff06d95fdffaae43a) - Holder contract for team tokens, vested weekly with TVL value all-time-high condition

[HolderTimelock](https://etherscan.io/address/0x0b713c0e7eeb43fcd7795c03ba64ea6a6f0e11ea) - Holder contract to reserve tokens for trade mining after launch

[HolderVesting](https://etherscan.io/address/0x6074Aabb7eA337403DC9dfF4217fe7d533B5E459) - Holder contract for operations vested for 1 year.

## Attributions

Much of the codebase used in previously deployed contracts (no longer in use) is modified from existing works, including:

[Compound](https://compound.finance) - Jumping off point for token code and governance

[Synthetix](https://synthetix.io) - Rewards staking contract

[YEarn](https://yearn.finance)/[YFI](https://ygov.finance) - Initial fair distribution implementation

## Developer notes

- The versions of truffle, truffle-upgrades, openzeppelin contracts, etc. in package.json and lock file versions were changing during the timeframe of project development.
  E.g. OpenZeppelin ERC20Upgradeable contract was patched manually when name() and symbol() missed the 'virtual' specifier, that was added at version 3.4 but did not exist when one of the contracts was created in this repository. Solidity compiler version was set to 0.8.0 in recent openzeppelin-contracts-upgradeable releases and it is recommended to use more updated versions of packages.

- The migration list is already long here, next updates would create new migrations lineup, stashing previous (current) state in a subfolder to keep code conveniently available.
