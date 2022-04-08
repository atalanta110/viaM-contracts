// contracts/SmartTreasuryV3FragmentPWC.sol
// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

///////////////////////////////////////////////////////////////////////////
//     __/|      
//  __/ //  /|   This smart contract is part of Mover infrastructure
// |/  //_///    https://viamover.com
//    |_/ //
//       |/
///////////////////////////////////////////////////////////////////////////

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155ReceiverUpgradeable.sol";
import "./interfaces/IERC1155PowerCard.sol";

// this is deployed as a separate contract (with it's own state related to PowerCard)
// it is stand-alone and upgradeable
contract SmartTreasuryFragmentPWC is Initializable, AccessControlUpgradeable, ERC1155ReceiverUpgradeable  {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeMathUpgradeable for uint256;

    // role that grants most of financial operations for Treasury (tresholds, etc.)
    bytes32 public constant FINMGMT_ROLE = keccak256("FINMGMT_ROLE");  // allowed to set tresholds and perform rebalancing

    // special values for PWC search for address (any numbers larger than 21 powercard minted)
    uint256 constant POWERCARD_NOT_FOUND = 32768; // PowerCard not found in staked info
    uint256 constant POWERCARD_UNSTAKE_LOCK = 32769; // PowerCard was unstaked, but is still in cooldown

    // probably these would remain constants, but made public to be accessible from view functions for convenience
    uint256 public POWERCARD_ACTIVE_PERIOD; // = 2592000; // 30 days
    uint256 public POWERCARD_COOLDOWN_PERIOD; // = 5184000; // 60 days

    // actual PWC (Semi-)NFT ERC1155 parameters
    address private PWCAddress; // address of ERC1155 PowerCard contract 0xd07dc4262BCDbf85190C01c996b4C06a461d2430;
    uint256 constant PWC_ID = 107150; // ID of PowerCard contract

    //https://docs.soliditylang.org/en/v0.6.2/miscellaneous.html
    //Use shorter types for struct elements and sort them such that short types are grouped together.
    // in theory, this 28-bytes struct element could be packed as less than uint256 bits (64 bytes)
    // there are 21 PowerCard NFTs in total
    struct NFTStake {
        uint32 timestamp; // 4-byte (32 bits)
	    address staker;   // 20-byte (160 bits)
        uint32 tsUnstaked; // 4-byte (32 bits) so after unstaking address cannot immediately stake again
                          // (but other address can, we currently don't think this would be abused, as ST stake should also be moved)
    }

    event PowercardStake(address account);
    event PowercardUnstake(address account);

    // staking data storage array
    NFTStake[] public nft_stakes;

    function initialize() public initializer {
        __Context_init_unchained();
        __AccessControl_init_unchained();

        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(FINMGMT_ROLE, _msgSender());
    }

    // set address for PWC contract
    function setPowercardAddress(address _address) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        PWCAddress = _address;
    }

    // set active and cooldown periods for powercard staking (in seconds)
    function setPowercardParams(uint256 _active, uint256 _cooldown) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        POWERCARD_ACTIVE_PERIOD = _active;
        POWERCARD_COOLDOWN_PERIOD = _cooldown;
    }

    // returns timestamp when the address that recently unstaked could stake again
    // (the lock period is for the address, not the card)
    function unstakeLockTimestamp(uint256 _stakeTS, uint256 _unstakeTS) view internal returns(uint256) {
        return _unstakeTS.sub(_stakeTS).div(POWERCARD_ACTIVE_PERIOD + POWERCARD_COOLDOWN_PERIOD).add(1).mul(POWERCARD_ACTIVE_PERIOD + POWERCARD_COOLDOWN_PERIOD).add(_stakeTS);
    }

    // return true if a staked at a specific timestamp powercard has active effect now
    function isPowerCardActive(uint _tsStaked) view public returns(bool)  {
        if (block.timestamp.sub(_tsStaked).mod(POWERCARD_ACTIVE_PERIOD + POWERCARD_COOLDOWN_PERIOD) < POWERCARD_ACTIVE_PERIOD) {
            return true;
        }
        return false;
    }

    // return true if a staked at a specific timestamp powercard is on cooldown now
    function isPowerCardCooldown(uint _tsStaked) view public returns(bool)  {
        if (block.timestamp.sub(_tsStaked).mod(POWERCARD_ACTIVE_PERIOD + POWERCARD_COOLDOWN_PERIOD) >= POWERCARD_ACTIVE_PERIOD) {
            return true;
        }
        return false;
    }
    
    // get remaining time (in seconds) for the specific powercard effect
    function getRemainingTimingsInt(uint _tsStaked) view internal returns(uint256 active, uint256 cooldown)  {
        if (isPowerCardActive(_tsStaked)) {
            active = POWERCARD_ACTIVE_PERIOD.sub(block.timestamp.sub(block.timestamp.sub(_tsStaked).div(POWERCARD_ACTIVE_PERIOD + POWERCARD_COOLDOWN_PERIOD).mul(POWERCARD_ACTIVE_PERIOD + POWERCARD_COOLDOWN_PERIOD).add(_tsStaked)));
            //cooldown = 0;'
        } else {
            //active = 0;
            cooldown = block.timestamp.sub(_tsStaked).div(POWERCARD_ACTIVE_PERIOD + POWERCARD_COOLDOWN_PERIOD).add(1).mul(POWERCARD_ACTIVE_PERIOD + POWERCARD_COOLDOWN_PERIOD).add(_tsStaked).sub(block.timestamp);
        }        
    }

    function getRemainingTimings(address _staker) view public returns(uint256 active, uint256 cooldown)  {
        return getRemainingTimingsInt(nft_stakes[getPowercardIndex(_staker)].timestamp);
    }

    // return index of a Powercard staked for an address (if found)
    // returns POWERCARD_NOT_FOUND if index not found
    // unstaked powercards are skipped
    function getPowercardIndex(address _owner) view public returns(uint256) {
        for (uint256 i = 0; i < nft_stakes.length; i++) {
            if (nft_stakes[i].staker == _owner) {
                if (nft_stakes[i].tsUnstaked == 0) {
                    return i;
                } else if (block.timestamp < unstakeLockTimestamp(nft_stakes[i].timestamp, nft_stakes[i].tsUnstaked)) {
                    return POWERCARD_UNSTAKE_LOCK;
                }
            }
        }
        return POWERCARD_NOT_FOUND;
    }


    //////////////////////////////////////////////////////////////////////////////
    // Stake/unstake of PowerCard
    //////////////////////////////////////////////////////////////////////////////

    // stake PowerCard, making it active for a period (and locking down for that period)
    // requires approval, transfers PWC to the contract address
    function stakePowercard() public {
        // as staked card can only be unstaked after active period passes, this provides
        // spoof-protection (so PWC could not be transferred across addresses and re-staked,
        // increasing array size, however, if all owners unstake and transfer cards to different
        // addresses immediately after active period and restake, then repeat, maximal size of
        // array before sweeping would be 63 records)
        require(nft_stakes.length < 63, "too much staking activity");
        sweepNFTArray();

        // check that this address has no powercards staked (no multiple stakes)
        // check when restaking card from same address when record is present in array
        uint256 index = this.getPowercardIndex(msg.sender);
        require(index != POWERCARD_UNSTAKE_LOCK, "recently unstaked cooldown");
        require(index == POWERCARD_NOT_FOUND, "already staked");

        //NOTE: we don't check allowance and balance (it would revert on transfer)
        //NOTE: this contract must implement the ERC1155Receiver interface
        IERC1155Powercard(PWCAddress).safeTransferFrom(msg.sender, address(this), PWC_ID, 1, "");

        NFTStake memory stake = NFTStake(uint32(block.timestamp), msg.sender, 0);
        nft_stakes.push(stake);

        emit PowercardStake(msg.sender);
    }

    // PowerCard could be unstaked only by its owner, and only during cooldown period
    // in such case, user gets card back on his wallet balance
    function unstakePowercard() public {
        uint256 index = this.getPowercardIndex(msg.sender);
        require(index != POWERCARD_NOT_FOUND, "not staked");
        require(!this.isPowerCardActive(nft_stakes[index].timestamp), "only on cooldown");

        // make unstaked timestamp mark
        nft_stakes[index].tsUnstaked = uint32(block.timestamp);
        // transfer one powercard from ST contract to user
        IERC1155Powercard(PWCAddress).safeTransferFrom(address(this), msg.sender, PWC_ID, 1, "");

        emit PowercardUnstake(msg.sender);
    }

    // remove NFT cards from array that were unstaked and cooldown has passed (could be called publicly)
    function sweepNFTArray() public {
        uint256 to_remove = 0;
        for (uint256 i = 0; i < nft_stakes.length - to_remove; i++) {
            // when card 'is active' by period calculation, but was unstaked, we can remove this record from array
            if(nft_stakes[i].tsUnstaked > 0 && block.timestamp >= unstakeLockTimestamp(nft_stakes[i].timestamp, nft_stakes[i].tsUnstaked)) {
                nft_stakes[i] = nft_stakes[nft_stakes.length - to_remove - 1];
                to_remove++;
            }
        }
        //nft_stakes.length -= to_remove; // Implicitly recovers gas from last elements storage
        // in current solidity versions resizing arrays through modifying lenth is not supported
        for (uint256 i = 0; i < to_remove; i++) {
            nft_stakes.pop();
        }
    }


    //////////////////////////////////////////////////////////////////////////////
    // ERC1155 receiver interface
    //////////////////////////////////////////////////////////////////////////////

    function onERC1155BatchReceived(address _operator, address _from, uint256[] calldata _ids, uint256[] calldata _values, bytes calldata _data) external override returns(bytes4) {
        return 0xbc197c81; // bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))
    }

    function onERC1155Received(address _operator, address _from, uint256 _id, uint256 _value, bytes calldata _data) external override returns(bytes4) {
        return 0xf23a6e61; // bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))
    }


    //////////////////////////////////////////////////////////////////////////////
    // Calculation functions used by Smart Treasury contract
    //////////////////////////////////////////////////////////////////////////////

    // getActiveNFTstakers is used by main Smart Treasury contract to
    // return addresses list with active staked PowerCard (21 address max)
    // such addresses are having increased yield (calculated by ST)
    function getActiveNFTstakers() public view returns (address[] memory, uint256) {
        uint length = 0;
        address[] memory stakers = new address[](21);
        for (uint256 index = 0; index < nft_stakes.length; index++) {
            if (nft_stakes[index].tsUnstaked == 0 && this.isPowerCardActive(nft_stakes[index].timestamp)) {
                stakers[length] = nft_stakes[index].staker;
                length++;
            }
        }
        return (stakers, length);
    }
}