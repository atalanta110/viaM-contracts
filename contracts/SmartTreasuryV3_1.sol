// contracts/SmartTreasuryV3.sol
// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

///////////////////////////////////////////////////////////////////////////
//     __/|      
//  __/ //  /|   This smart contract is part of Mover infrastructure
// |/  //_///    https://viamover.com
//    |_/ //
//       |/
///////////////////////////////////////////////////////////////////////////

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "./ERC20PresetDecimals/ERC20PresetDecimals.sol";
import "./ERC20Permit/ERC20PermitUpgradeableDecimals.sol";
import "./interfaces/IMasterChef.sol";
import "./utils/SafeAllowanceResetUpgradeable.sol";

import "./interfaces/ISmartTreasuryLibraryPWC.sol";
import "./interfaces/IUniswapRouterV2Minimal.sol";

/*
    SmartTreasury is a contract to handle:
    - staking/unstaking of supported tokens;
    - distribution of yield to bonus and endowment portions;
    - rebalancing of asset allocation;
    - claiming treasury portion through token burn;
    - getting eth for subsidizing a transaction;
    - ERC20 functions for bonus token;
    - administrative functions (tresholds);
    - emergency recover functions (timelocked).

    V2: provide staking of SLP tokens to MasterChef to receive and distribute SUSHI rewards

    V3: automatic harvesting of Sushi rewards and converting them to USDC as a treasury profit
        fair bonus distribution between MOVE and MOVE-ETH SLP
        staking of NFT 'PowerCard' (EIP1155) for increased yield
*/
contract SmartTreasuryV3_1 is ERC20PresetMinterPauserUpgradeableDecimals, ERC20PermitUpgradeableDecimals, SafeAllowanceResetUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeMathUpgradeable for uint256;


    // role that grants most of financial operations for Treasury (tresholds, etc.)
    bytes32 public constant FINMGMT_ROLE = keccak256("FINMGMT_ROLE");  // allowed to set tresholds and perform rebalancing
    // role that grants ability to spend and rebate bonuses
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE"); // allowed to fetch asset portion (for gas subsidy)


    ///////////////////////////////////////////////////////////////////////////
    // BASE VARIABLES
    ///////////////////////////////////////////////////////////////////////////
    address public baseToken;           // USDC
    uint256 public endowmentPercent;    // 1e18 percentage of yield portion that goes to endowment, can be changed, won't affect current bonuses
    uint256 public endowmentBalance;    // total endowment balance (in USDC)
    uint256 public bonusBalance;        // total bonus balance (in USDC) to help with accounting
    uint256 public burnLimit;           // 1e18 decimals of maximum tokens allowed to be burned in on tx (default is 1e17=10%)
    uint256 public burnEndowmentMultiplier; // 1e18 when burning tokens, endowment


    ///////////////////////////////////////////////////////////////////////////
    // STAKING/UNSTAKING VARIABLES AND EVENTS
    ///////////////////////////////////////////////////////////////////////////
    // supported tokens for staking into treasury are Mover (MOVE) token and MOVE-ETH LP token from sushiswap pool
    // as mentioned in yellow paper, we don't create stakeable tokens data as array to save gas, expansion could be done via contract upgrade
    address public tokenMoveAddress;
    uint public tokenMoveWeight;
    address public tokenMoveEthLPAddress;
    uint public tokenMoveEthLPWeight;

    event Deposit(address indexed account, uint256 amountMove, uint256 amountMoveEthLP);
    event Withdraw(address indexed account, uint256 amountMove, uint256 amountMoveEthLP);
    event EmergencyWithdraw(address indexed account, uint256 amountMove, uint256 amountMoveEthLP);
    event ReceiveProfit(uint256 amountEndowment, uint256 amountBonus);


    uint256 accBonusPerShareMove;
    uint256 accBonusPerShareMoveEthLP;
    uint256 public totalStakedMove;
    uint256 public totalStakedMoveEthLP;

    struct UserInfo {
        uint256 amount;
        uint256 rewardTally;
    }

    mapping (address => UserInfo) public userInfoMove;
    mapping (address => UserInfo) public userInfoMoveEthLP;


    ///////////////////////////////////////////////////////////////////////////
    // EMERGENCY TRANSFER (TIMELOCKED) VARIABLES AND EVENTS
    ///////////////////////////////////////////////////////////////////////////
    event EmergencyTransferSet(
        address indexed token,
        address indexed destination,
        uint256 amount
    );
    event EmergencyTransferExecute(
        address indexed token,
        address indexed destination,
        uint256 amount
    );
    address private emergencyTransferToken;
    address private emergencyTransferDestination;
    uint256 private emergencyTransferTimestamp;
    uint256 private emergencyTransferAmount;


    ///////////////////////////////////////////////////////////////////////////
    // CLAIM & BURN EVENTS
    ///////////////////////////////////////////////////////////////////////////
    event ClaimAndBurn(address indexed account, uint256 amountMove, uint256 amountCompensation);
    
    // for simple DPY stats calculation
    uint256 public inceptionTimestamp;    // inception timestamp

    ///////////////////////////////////////////////////////////////////////////
    // CONSTRUCTOR/INITIALIZER
    ///////////////////////////////////////////////////////////////////////////
    // NOTE: BONUS TOKENS SHOULD CONTAIN SAME DECIMALS AS BASE ASSET (USDC=6)
    /* removed to save contract implementation bytecode size (contract data was already initialized in 1st version)
    function initialize(string memory name, 
                        string memory symbol, 
                        address _baseToken, // USDC
                        address _tokenMove, // MOVE
                        address _tokenMoveEth) // Sushiswap MOVE-ETH LP
                        public initializer {
        __Context_init_unchained();
        __AccessControl_init_unchained();
        __ERC20_init_unchained(name, symbol, 6); // bonus token has 6 decimals as USDC
        __ERC20Burnable_init_unchained();
        __Pausable_init_unchained();
        __ERC20Pausable_init_unchained();
        __ERC20PresetMinterPauser_init_unchained(name, symbol); // sets up DEFAULT_ADMIN_ROLE
        __ERC20Permit_init(name);

        baseToken = _baseToken;
        tokenMoveAddress = _tokenMove;
        tokenMoveEthLPAddress = _tokenMoveEth;

        inceptionTimestamp = block.timestamp;

        endowmentPercent = 50000000000000000000; // 50% of yield goes to endowment
        endowmentBalance = 0;
        bonusBalance = 0;
        burnLimit = 100000000000000000; // 0.1, 10% of supply could be burned in one tx
        tokenMoveWeight = 1000;
        tokenMoveEthLPWeight = 2500;
        burnEndowmentMultiplier = 4000000000000000000; // 4x multiplier for burn operation
    }
    */

    ///////////////////////////////////////////////////////////////////////////
    // FINMGMT FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////

    function setEndowmentPercentage(uint256 _endowmentPercent) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        endowmentPercent = _endowmentPercent;
    }

    function setBurnLimit(uint256 _burnLimit) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        burnLimit = _burnLimit;
    }

    function setEndowmentBurnMultiplier(uint256 _burnEndowmentMultiplier) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        burnEndowmentMultiplier = _burnEndowmentMultiplier;
    }

    ///////////////////////////////////////////////////////////////////////////
    // TREASURY STAKE/UNSTAKE FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////

    function pendingBonus(address _account) public view returns(uint256) {
        UserInfo storage userMove = userInfoMove[_account];
        UserInfo storage userMoveEthLP = userInfoMoveEthLP[_account];

        uint256 pendingBonusMove = userMove.amount.mul(accBonusPerShareMove).div(1e24).sub(userMove.rewardTally);
        return pendingBonusMove.add(userMoveEthLP.amount.mul(accBonusPerShareMoveEthLP).div(1e24).sub(userMoveEthLP.rewardTally));
    }

    // returns available bonus, including inner balance and tokens on wallet address
    function totalBonus(address _account) public view returns(uint256) {
        uint256 balancePending = pendingBonus(_account);
        uint256 balanceTokens = IERC20Upgradeable(address(this)).balanceOf(_account);
        return balancePending.add(balanceTokens);
    }

    // users should stake treasury through transfer proxy to avoid setting allowance to this contract for staked tokens
    function deposit(uint _tokenMoveAmount, uint _tokenMoveEthAmount) public {
        depositInternal(msg.sender, _tokenMoveAmount, _tokenMoveEthAmount, false);
    }

    function depositInternal(address _account, uint _tokenMoveAmount, uint _tokenMoveEthAmount, bool _skipTransfer) internal {

        UserInfo storage userMove = userInfoMove[_account];
        UserInfo storage userMoveEthLP = userInfoMoveEthLP[_account];

        // if harvest wasn't performed for a long time, perform harvest
        // obsolete: don't harvest sushi on deposit/withdraws, they are auto-converted to USDC now
        //if (block.number.sub(sushiHarvestedBlock) > HARVEST_BLOCK_TRESHOLD) {
        //    withdrawSLPint(0);
        //}

        // if SLP tokens were staked, distribute SUSHI rewards
        if (userMoveEthLP.amount > 0) {
            rewardSushi(_account);
        }

        if (userMove.amount > 0 || userMoveEthLP.amount > 0) {
            uint256 pending = userMove.amount.mul(accBonusPerShareMove).div(1e24).sub(userMove.rewardTally);
            pending = pending.add(userMoveEthLP.amount.mul(accBonusPerShareMoveEthLP).div(1e24).sub(userMoveEthLP.rewardTally));
            if(pending > 0) {
                _mint(_account, pending); //pay the earned tokens when user deposits
            }
        }

        // this condition would save some gas on harvest calls
        if (_tokenMoveAmount > 0) {
            if(!_skipTransfer) {
                IERC20Upgradeable(tokenMoveAddress).safeTransferFrom(msg.sender, address(this), _tokenMoveAmount);
            }
            userMove.amount = userMove.amount.add(_tokenMoveAmount);
            totalStakedMove = totalStakedMove.add(_tokenMoveAmount);
        }
        if (_tokenMoveEthAmount > 0) {
            if(!_skipTransfer) {
                IERC20Upgradeable(tokenMoveEthLPAddress).safeTransferFrom(msg.sender, address(this), _tokenMoveEthAmount);
            }
            userMoveEthLP.amount = userMoveEthLP.amount.add(_tokenMoveEthAmount);
            totalStakedMoveEthLP = totalStakedMoveEthLP.add(_tokenMoveEthAmount);
        }

        userMove.rewardTally = userMove.amount.mul(accBonusPerShareMove).div(1e24);
        userMoveEthLP.rewardTally = userMoveEthLP.amount.mul(accBonusPerShareMoveEthLP).div(1e24);

        sushiRewardTally[_account] = userMoveEthLP.amount.mul(accSushiPerShare).div(1e24);

        emit Deposit(_account, _tokenMoveAmount, _tokenMoveEthAmount);
    }

    function withdraw(uint _tokenMoveAmount, uint _tokenMoveEthAmount) public {
        withdrawInternal(msg.sender, _tokenMoveAmount, _tokenMoveEthAmount);
    }

    function withdrawInternal(address _account, uint _tokenMoveAmount, uint _tokenMoveEthAmount) internal {

        UserInfo storage userMove = userInfoMove[_account];
        UserInfo storage userMoveEthLP = userInfoMoveEthLP[_account];

        // if there's not enough SLP tokens, withdraw staked from MasterChef, this would also trigger harvest
        if (_tokenMoveEthAmount > 0) {
            uint256 slpBalance = IERC20Upgradeable(tokenMoveEthLPAddress).balanceOf(address(this));
            if (_tokenMoveEthAmount > slpBalance) {
                withdrawSLPint(_tokenMoveEthAmount.sub(slpBalance));
            }
        }
        
        // if harvest wasn't performed for a long time, perform harvest
        //if (block.number.sub(sushiHarvestedBlock) > HARVEST_BLOCK_TRESHOLD) {
        //    withdrawSLPint(0);
        //}

        // if SLP tokens were staked, distribute SUSHI rewards
        if (userMoveEthLP.amount > 0) {
            rewardSushi(_account);
        }

        if (userMove.amount > 0 || userMoveEthLP.amount > 0) {
            uint256 pending = userMove.amount.mul(accBonusPerShareMove).div(1e24).sub(userMove.rewardTally);
            pending = pending.add(userMoveEthLP.amount.mul(accBonusPerShareMoveEthLP).div(1e24).sub(userMoveEthLP.rewardTally));
            if(pending > 0) {
                _mint(_account, pending); //pay the earned tokens when user deposits
            }
        }

        require(userMove.amount >= _tokenMoveAmount, "withdraw: insufficient balance");
        require(userMoveEthLP.amount >= _tokenMoveEthAmount, "withdraw: insufficient balance");

        if (_tokenMoveAmount > 0) {
            IERC20Upgradeable(tokenMoveAddress).safeTransfer(address(_account), _tokenMoveAmount);
        }
        if (_tokenMoveEthAmount > 0) {
            IERC20Upgradeable(tokenMoveEthLPAddress).safeTransfer(address(_account), _tokenMoveEthAmount);
        }

        totalStakedMove = totalStakedMove.sub(_tokenMoveAmount);
        totalStakedMoveEthLP = totalStakedMoveEthLP.sub(_tokenMoveEthAmount);

        userMove.amount = userMove.amount.sub(_tokenMoveAmount);
        userMove.rewardTally = userMove.amount.mul(accBonusPerShareMove).div(1e24);
        userMoveEthLP.amount = userMoveEthLP.amount.sub(_tokenMoveEthAmount);
        userMoveEthLP.rewardTally = userMoveEthLP.amount.mul(accBonusPerShareMoveEthLP).div(1e24);

        sushiRewardTally[_account] = userMoveEthLP.amount.mul(accSushiPerShare).div(1e24);

        emit Withdraw(_account, _tokenMoveAmount, _tokenMoveEthAmount);
    }

    function emergencyWithdraw() public {
        UserInfo storage userMove = userInfoMove[msg.sender];
        UserInfo storage userMoveEthLP = userInfoMoveEthLP[msg.sender];

        // if there's not enough SLP tokens, withdraw staked from MasterChef
        if (userMoveEthLP.amount > 0) {
            uint256 slpBalance = IERC20Upgradeable(tokenMoveEthLPAddress).balanceOf(address(this));
            if (userMoveEthLP.amount > slpBalance) {
                withdrawSLPint(userMoveEthLP.amount.sub(slpBalance));
            }
        }

        IERC20Upgradeable(tokenMoveAddress).safeTransfer(address(msg.sender), userMove.amount);
        IERC20Upgradeable(tokenMoveEthLPAddress).safeTransfer(address(msg.sender), userMoveEthLP.amount);

        totalStakedMove = totalStakedMove.sub(userMove.amount);
        totalStakedMoveEthLP = totalStakedMoveEthLP.sub(userMoveEthLP.amount);

        emit EmergencyWithdraw(msg.sender, userMove.amount, userMove.rewardTally);

        userMove.amount = 0;
        userMove.rewardTally = 0;
        userMoveEthLP.amount = 0;
        userMoveEthLP.rewardTally = 0;

        sushiRewardTally[msg.sender] = 0;
    }

    // called when profit distribution occurs by profit distributor contract
    // but can be called by anyone (e.g. for donation)
    // _sushiHarvest is for convenience to save 21k gas on calling it separately
    function receiveProfit(uint256 _amount, bool _sushiHarvest) public {
        if (_sushiHarvest) {
            withdrawSLPint(0); // receive and convert sushi
        }

        if (_amount == 0) {
            return; // for pure sushi harvest calls to be cheaper
        }

        // transfer base token (USDC) to this contract
        IERC20Upgradeable(baseToken).safeTransferFrom(msg.sender, address(this), _amount);

        // if nothing is taked into treasury, fulfill only endowment portion
        if (totalStakedMove == 0 && totalStakedMoveEthLP == 0) {
            endowmentBalance = endowmentBalance.add(_amount);
            return;
        }

        uint256 endowmentPortion = _amount.mul(endowmentPercent).div(1e20);
        uint256 bonusPortion = _amount.sub(endowmentPortion);


        //uint256 totalWeight = tokenMoveWeight + tokenMoveEthLPWeight;

        // TODO: calculate how much MOVER tokens are in 1 SLP from pair contract at this block
        // MOVE per 1 SLP = MOVE.balanceOf(pool) *1e18 (for int-representation) / pool.totalSupply (they have same 18 decimals)
        uint256 MOVEperLP = IERC20Upgradeable(tokenMoveAddress).balanceOf(tokenMoveEthLPAddress).mul(1e18).div(IERC20Upgradeable(tokenMoveEthLPAddress).totalSupply());
        uint256 totalLPShares = totalStakedMoveEthLP.mul(tokenMoveEthLPWeight).mul(MOVEperLP).div(1e18);
        uint256 totalShares = totalStakedMove.mul(tokenMoveWeight).add(totalLPShares);


        // process powercards, mint MOBOs to such addresses
        // (active powercard makes particular user share 2x larger)
        uint256 totalPWCMoveWeight = 1;
        uint256 totalPWCMoveLPWeight = 1;
        
        if (TreasuryPWCAddress != address(0)) {
            // make call to the ST PowerCard helper contract
            (address[] memory stakers, uint256 stlen) = ISmartTreasuryLibraryPWC(TreasuryPWCAddress).getActiveNFTstakers();
            for (uint256 index = 0; index < stlen; index++) {
                totalPWCMoveWeight = totalPWCMoveWeight.add( (userInfoMove[stakers[index]]).amount.mul(tokenMoveWeight) );
                totalPWCMoveLPWeight = totalPWCMoveLPWeight.add( (userInfoMoveEthLP[stakers[index]]).amount.mul(tokenMoveEthLPWeight).mul(MOVEperLP).div(1e18) );
            }   

            uint256 PWCPortion = bonusPortion.mul(totalPWCMoveWeight + totalPWCMoveLPWeight).div(totalShares + totalPWCMoveWeight + totalPWCMoveLPWeight);
            bonusPortion = bonusPortion.sub(PWCPortion);

            // distribute bonus tokens for powercard portion immediately
            // using calculated values of PWC portion, user shares and total PWC-accounted shares
            for (uint256 index = 0; index < stlen; index++) {
                uint256 thisPowercardUserShares = (userInfoMove[stakers[index]]).amount.mul(tokenMoveWeight) + (userInfoMoveEthLP[stakers[index]]).amount.mul(tokenMoveEthLPWeight).mul(MOVEperLP).div(1e18);
                uint256 thisPowercardAmount = PWCPortion.mul(thisPowercardUserShares).div(totalPWCMoveWeight + totalPWCMoveLPWeight);
                // we can save some gas not doing _mint with event emission
                // and increase total supply only once, but this would make things
                // less transparent and probably is not worth the gas savings
                _mint(stakers[index], thisPowercardAmount);
            }
        }

        endowmentBalance = endowmentBalance.add(endowmentPortion);
        bonusBalance = bonusBalance.add(bonusPortion);

        uint256 bonusPortionMove = bonusPortion.mul(totalStakedMove).mul(tokenMoveWeight).div(totalShares);
        uint256 bonusPortionMoveEthLP = bonusPortion.sub(bonusPortionMove);

        if (totalStakedMove > 0) {
            accBonusPerShareMove = accBonusPerShareMove.add(bonusPortionMove.mul(1e24).div(totalStakedMove));
        }
        if (totalStakedMoveEthLP > 0) {
            accBonusPerShareMoveEthLP = accBonusPerShareMoveEthLP.add(bonusPortionMoveEthLP.mul(1e24).div(totalStakedMoveEthLP));
        }

        emit ReceiveProfit(endowmentPortion, bonusPortion);
    }


    ///////////////////////////////////////////////////////////////////////////
    // SUBSIDIZED EXECUTION FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////

    // called by execution proxy when spending bonus on subsidized txes
    // or correction if actual gas spending was higher than actual
    // would also be used for KYC costs, etc.
    function spendBonus(address _account, uint256 _amount) public {
        require(hasRole(EXECUTOR_ROLE, msg.sender), "executor only");
        spendBonusInternal(_account, _amount);
    }
        
    function spendBonusInternal(address _account, uint256 _amount) internal {
        UserInfo storage userMove = userInfoMove[_account];
        UserInfo storage userMoveEthLP = userInfoMoveEthLP[_account];
        uint256 pendingBonusMove = userMove.amount.mul(accBonusPerShareMove).div(1e24).sub(userMove.rewardTally);
        uint256 pendingBonusMoveEthLP = userMoveEthLP.amount.mul(accBonusPerShareMoveEthLP).div(1e24).sub(userMoveEthLP.rewardTally);
        uint256 tokenBonus = IERC20Upgradeable(this).balanceOf(_account);

        require(pendingBonusMove.add(pendingBonusMoveEthLP).add(tokenBonus) >= _amount, "not enough bonus");

        // spend pending bonus first, MOVE-ETH LP bonus first
        if (pendingBonusMoveEthLP >= _amount) {
            // spend only pending MOVE-ETH LP bonus
            userMoveEthLP.rewardTally = userMoveEthLP.rewardTally.add(_amount);
        } else if (pendingBonusMove.add(pendingBonusMoveEthLP) >= _amount) {
            // spend all pending MOVE-ETH LP bonus and portion of pending MOVE-ETH bonus
            userMoveEthLP.rewardTally = userMoveEthLP.amount.mul(accBonusPerShareMoveEthLP).div(1e24); // set zero-point
            userMove.rewardTally = userMove.rewardTally.add(_amount.sub(pendingBonusMoveEthLP));
        } else {
            // spend all pending MOVE-ETH LP bonus, all pending MOVE-ETH bonus and burn some tokens
            userMove.rewardTally = userMove.amount.mul(accBonusPerShareMove).div(1e24); // set zero-point
            userMoveEthLP.rewardTally = userMoveEthLP.amount.mul(accBonusPerShareMoveEthLP).div(1e24); // set zero-point
            _burn(_account, _amount.sub(pendingBonusMove).sub(pendingBonusMoveEthLP));
        }

        bonusBalance = bonusBalance.sub(_amount);
    }

    // called by execution proxy if gas spending is less than actual
    // rebate is issued in form of tokens
    function rebateBonus(address _account, uint256 _amount) public {        
        require(hasRole(EXECUTOR_ROLE, msg.sender), "executor only");
        _mint(_account, _amount);
        bonusBalance = bonusBalance.add(_amount);
    }

    // deposit not requiring allowance of MOVE or MOVE-ETH LP for this contract
    // actual transfer is organized beforehand by trusted party (execution proxy)
    function depositOnBehalf(address _account, uint _tokenMoveAmount, uint _tokenMoveEthAmount) public {
        require(hasRole(EXECUTOR_ROLE, msg.sender), "executor only");
        depositInternal(_account, _tokenMoveAmount, _tokenMoveEthAmount, true);
    }

    function withdrawOnBehalf(address _account, uint _tokenMoveAmount, uint _tokenMoveEthAmount) public {
        require(hasRole(EXECUTOR_ROLE, msg.sender), "executor only");
        withdrawInternal(_account, _tokenMoveAmount, _tokenMoveEthAmount);
    }

    ///////////////////////////////////////////////////////////////////////////
    // CLAIM & BURN FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////

    function maxBurnAmount() public view returns(uint256) {
        uint256 totalSupply = IERC20Upgradeable(tokenMoveAddress).totalSupply();
        return totalSupply.mul(burnLimit).div(1000000000000000000);
    }

    function getBurnValue(address _account, uint256 _amount) public view returns(uint256) {
        (uint256 endowmentPortion, uint256 bonusPortion) = getBurnValuePortions(_account, _amount);
        return endowmentPortion.add(bonusPortion);
    }

    function getBurnValuePortions(address _account, uint256 _amount) public view returns(uint256, uint256) {
        uint256 totalSupply = IERC20Upgradeable(tokenMoveAddress).totalSupply();
        uint256 endowmentPortion = _amount.mul(1000000000000000000).div(totalSupply).mul(endowmentBalance).div(1000000000000000000);

        uint256 bonusPortion = totalBonus(_account); 
        // bonus compensation cannot be higher than MOVE burned portion (bonus tokens could be transferred)
        // to prevent burning bonus for USDC directly
        if (bonusPortion > endowmentPortion) {
            bonusPortion = endowmentPortion; 
        }

        // endowment portion has a multiplier for rewarding reducing number of MOVE tokens
        endowmentPortion = endowmentPortion.mul(burnEndowmentMultiplier).div(1e18);

        return (endowmentPortion, bonusPortion);
    }

    // executor proxy performs burn as it has allowance on MOVE token and calls this method
    function claimAndBurnOnBehalf(address _beneficiary, uint256 _amount) public {
        require(hasRole(EXECUTOR_ROLE, msg.sender), "executor only");
        require(_amount <= maxBurnAmount(), "max amount exceeded");

        (uint256 endowmentPortion, uint256 bonusPortion) = getBurnValuePortions(_beneficiary, _amount);

        if (bonusPortion > 0) {
            spendBonusInternal(_beneficiary, bonusPortion);
        }

        // if not enough balance, divest funds from yield generating products
        // (this is undesireable, should be covered by rebalancer)
        // if (IERC20Upgradeable(baseToken).balanceOf(address(this)) < endowmentPortion.add(bonusPortion)) {
            // TODO: perform rebalance (should be required when treasury stakes its portion)
        //}

        uint256 baseTokenToTransfer = endowmentPortion.add(bonusPortion);
        IERC20Upgradeable(baseToken).safeTransfer(_beneficiary, baseTokenToTransfer);
        endowmentBalance = endowmentBalance.sub(endowmentPortion);
        emit ClaimAndBurn(_beneficiary, _amount, baseTokenToTransfer);
    }

    // This is oversimplified, no compounding and averaged across timespan from inception
    // we don't know price of MOVE token here, so it should be divided by MOVE price in apps
    function getDPYPerMoveToken() public view returns(uint256) {
      uint256 secondsFromInception = block.timestamp.sub(inceptionTimestamp);
      
      // calculate as total amassed endowment valuation to total number of tokens staked
      uint256 totalMoveStakedEquivalent = totalStakedMove;

      // add equivalent underlying MOVE for MOVE-ETH LP
      uint256 moveInLP = IERC20Upgradeable(tokenMoveEthLPAddress).balanceOf(tokenMoveAddress);
      uint256 totalLP = IERC20Upgradeable(tokenMoveEthLPAddress).totalSupply();
      if (totalLP > 0) {
        totalMoveStakedEquivalent = totalMoveStakedEquivalent.add(totalStakedMoveEthLP.mul(moveInLP).div(totalLP));
      }
      
      if (totalMoveStakedEquivalent == 0) {
          return 0; // no APY can be formulated as zero tokens staked
      }

      // endowmentBalance has 6 decimals as USDC, so to get 1e18 decimals, multiply by 1e12 and by 100 to get %
      uint256 baseAssetPerDay = endowmentBalance.mul(1e12).mul(100).mul(86400).div(secondsFromInception);

      return baseAssetPerDay.mul(1e18).div(totalMoveStakedEquivalent);
    }


    ///////////////////////////////////////////////////////////////////////////
    // ERC20 MOVER BONUS TOKEN FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20PresetMinterPauserUpgradeableDecimals, ERC20UpgradeableDecimals) {
        super._beforeTokenTransfer(from, to, amount);
    }

    // add new variables that can be renamed
    string private _token_name;
    string private _token_symbol;

    function name() public override view returns (string memory) {
        return _token_name;
    }

    function symbol() public override view returns (string memory) {
        return _token_symbol;
    }

    // set the name and symbol for the token
    // callable only by admin
    function setTokenName(string memory _symbol, string memory _name) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        _token_name = _name;
        _token_symbol = _symbol;
        _EIP712SetNameHash(_name);
    }

    // airdrop tokens (used to distributed bonus tokens)
	// callable only by admin
    /* removed, not required
	function airdropTokens(address[] calldata _recipients, uint256[] calldata _amounts) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        require(_recipients.length == _amounts.length, "array length mismatch");
		for(uint256 i = 0; i < _recipients.length; i++) {
            _mint(_recipients[i], _amounts[i]);
        }
	}
    */


    ///////////////////////////////////////////////////////////////////////////
    // EMERGENCY FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////

    // emergencyTransferTimelockSet is for safety (if some tokens got stuck)
    // in the future it could be removed, to restrict access to user funds
    // this is timelocked as contract can have user funds
    function emergencyTransferTimelockSet(
        address _token,
        address _destination,
        uint256 _amount
    ) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        emergencyTransferTimestamp = block.timestamp;
        emergencyTransferToken = _token;
        emergencyTransferDestination = _destination;
        emergencyTransferAmount = _amount;

        emit EmergencyTransferSet(_token, _destination, _amount);
    }

    function emergencyTransferExecute() public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        require(
            block.timestamp > emergencyTransferTimestamp + 24 * 3600,
            "timelock too early"
        );
        require(
            block.timestamp < emergencyTransferTimestamp + 72 * 3600,
            "timelock too late"
        );

        IERC20Upgradeable(emergencyTransferToken).safeTransfer(
            emergencyTransferDestination,
            emergencyTransferAmount
        );

        emit EmergencyTransferExecute(
            emergencyTransferToken,
            emergencyTransferDestination,
            emergencyTransferAmount
        );
        // clear emergency transfer timelock data
        emergencyTransferTimestamp = 0;
        emergencyTransferToken = address(0);
        emergencyTransferDestination = address(0);
        emergencyTransferAmount = 0;
    }

    ///////////////////////////////////////////////////////////////////////////
    // SUSHI LP STAKING FUNCTIONS
    ///////////////////////////////////////////////////////////////////////////
    //address public constant MASTERCHEF_ADDRESS = 0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd;
    //address public constant SUSHI_ADDRESS = 0x6B3595068778DD592e39A122f4f5a5cF09C90fE2;
    
    // this for tests only, reduce using] constants in PROD contract
    address public MASTERCHEF_ADDRESS;
    address public SUSHI_ADDRESS;
    uint public MASTERCHEF_POOLID;
    
    /*
    // removed for saving bytecode volume
    function setSushiAddresses(address _masterChef, address _sushiToken, uint _poolId) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        MASTERCHEF_ADDRESS = _masterChef;
        SUSHI_ADDRESS = _sushiToken;
        MASTERCHEF_POOLID = _poolId;
    }
    */

    uint256 private constant ALLOWANCE_SIZE = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    uint256 private constant HARVEST_BLOCK_TRESHOLD = 6400; // approximately one day
    
    // percentage of sushi that is allocated to Smart Treasury itself 1000000000000000000 = 1%
    uint256 public treasuryFeeSushi;
    // current sushi accumulated per single share
    uint256 public accSushiPerShare;
    // last block on which sushi were harvested
    uint256 public sushiHarvestedBlock;     // obsolete, unused
    // sushi pending markings for accounts
    mapping (address => uint256) public sushiRewardTally;

    // Smart Treasury's own sushi
    uint256 public treasurySushi;   // this is old name which is obsolete and not used
                                    // openzeppelin does not support renames yet conveniently
                                    // so just considering this variable named 'feesUSDC'

    event ReceiveSushi(uint256 sushiAmount);

    function setSushiFee(uint256 _feeSushi) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        treasuryFeeSushi = _feeSushi;
    }

    // could also be used to harvest pending SUSHI rewards
    function depositSLP(uint256 _amount) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        depositSLPint(_amount);
    }

    // could also be used to harvest pending SUSHI rewards
    function withdrawSLP(uint256 _amount) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        withdrawSLPint(_amount);
    }

    function depositSLPint(uint256 _amount) internal {
        uint256 sushiBefore = IERC20Upgradeable(SUSHI_ADDRESS).balanceOf(address(this));

        resetAllowanceIfNeeded(IERC20Upgradeable(tokenMoveEthLPAddress), MASTERCHEF_ADDRESS, ALLOWANCE_SIZE);

        // make deposit call to MasterChef
        IMasterChef(MASTERCHEF_ADDRESS).deposit(MASTERCHEF_POOLID, _amount); // MOVE-ETH LP pool id is 257 (0x101)

        uint256 sushiAfter = IERC20Upgradeable(SUSHI_ADDRESS).balanceOf(address(this));
        //distributeSushi(sushiBefore, sushiAfter);
        harvestSushiProfit(sushiAfter.sub(sushiBefore)); // convert and distribute USDC from SUSHI

        //sushiHarvestedBlock = block.number;
    }

    // called by FINMGMT or when there's not enough SLP when someone withdraws
    function withdrawSLPint(uint256 _amount) internal returns(uint256 receivedSushi) {
        if (MASTERCHEF_ADDRESS == address(0)) {
            return 0; // sushi rewards staking is not enabled
        }

        uint256 sushiBefore = IERC20Upgradeable(SUSHI_ADDRESS).balanceOf(address(this));

        // make withdraw call to MasterChef
        IMasterChef(MASTERCHEF_ADDRESS).withdraw(MASTERCHEF_POOLID, _amount); // MOVE-ETH LP pool id is 257 (0x101)

        uint256 sushiAfter = IERC20Upgradeable(SUSHI_ADDRESS).balanceOf(address(this));
        //distributeSushi(sushiBefore, sushiAfter);
        receivedSushi = sushiAfter.sub(sushiBefore); // to use as return value
        harvestSushiProfit(receivedSushi); // convert and distribute USDC from SUSHI

        //sushiHarvestedBlock = block.number;
    }

    /*
        this function is obsolete, we auto-harvest sushi rewards in USDC now

    function distributeSushi(uint256 _before, uint256 _after) internal {
        if (_before >= _after) {
            return; // don't revert, just do nothing
        }

        uint256 receivedSushi = _after.sub(_before);
        if (treasuryFeeSushi > 0) {
            uint256 sushitotreasury = receivedSushi.mul(treasuryFeeSushi).div(1e20);
            treasurySushi = treasurySushi.add(sushitotreasury);
            receivedSushi = receivedSushi.sub(sushitotreasury);
        }

        accSushiPerShare = accSushiPerShare.add(receivedSushi.mul(1e24).div(totalStakedMoveEthLP));
        emit ReceiveSushi(receivedSushi);
    }
    */

    // transfer pending SUSHI (that were assigned before auto-harvest)
    function rewardSushi(address _account) internal {
        UserInfo storage userMoveEthLP = userInfoMoveEthLP[_account];
        if (userMoveEthLP.amount == 0) {
            return; // no SUSHI rewards if no SLPs staked
        }

        uint256 pendingSushi = userMoveEthLP.amount.mul(accSushiPerShare).div(1e24).sub(sushiRewardTally[_account]);
        if(pendingSushi > 0) {
            IERC20Upgradeable(SUSHI_ADDRESS).safeTransfer(_account, pendingSushi); //pay the earned SUSHI rewards
        }
    }

    /*
        this function is obsolete, we auto-harvest sushi rewards in USDC now
    function getTreasurySushi(uint256 _amount, address _receiver) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        require(_amount <= treasurySushi, "amount exceeds balance");
        IERC20Upgradeable(SUSHI_ADDRESS).safeTransfer(_receiver, _amount);
        treasurySushi = treasurySushi.sub(_amount);
    }
    */


    ///////////////////////////////////////////////////////////////////////////
    // V3 upgrade: PowerCard features
    // (most are implemented as separate contract handling PowerCards staking
    //  to avoid contract size limit)
    ///////////////////////////////////////////////////////////////////////////
    address private TreasuryPWCAddress;

    function setPowercardFragment(address _address) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        TreasuryPWCAddress = _address;
    }

    ///////////////////////////////////////////////////////////////////////////
    // V3 upgrade: Sushi harvest features
    // (Sushi price assumed correct)
    ///////////////////////////////////////////////////////////////////////////

    // SushiSwap V2 router is used
    // https://etherscan.io/address/0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F
    address private swapRouterAddress;

    function setSwapRouterAddress(address _swapRouterAddress) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        swapRouterAddress = _swapRouterAddress;
    }

    // harvestSushiProfit is called by receiveProfit function (if a bool parameter is provided)
    // it harvests sushi, converts to USDC and returns amount of USDC received (which is distributed
    // across LP stakers only)
    function harvestSushiProfit(uint256 _sushiHarvested) internal {
        if (swapRouterAddress == address(0) || _sushiHarvested == 0) {
            return; // don't convert anything, just harvest (for tests mainly), don't increase pending bonuses
        }

        // pending sushis to stakers, but all new sushi are auto-harvested
        // withdraw SLP calls this function either when someone withdraws or in receiveProfit

        // approve sushi token to router
        resetAllowanceIfNeeded(IERC20Upgradeable(SUSHI_ADDRESS), swapRouterAddress, _sushiHarvested);

        // perform swap of SUSHI to USDC
        // most liquid path is SUSHI->WETH->USDC
        address[] memory path = new address[](3);
        path[0] = SUSHI_ADDRESS; // Sushi token address;
        path[1] = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // WETH
        path[2] = baseToken;     // USDC address;

        // NOTE: we can use returned amounts array from router call, but use own calculation for safety
        // this is called regularly, so we use min amount received == 1 for conversion
        uint256 USDCbefore = IERC20Upgradeable(baseToken).balanceOf(address(this));
        IUniswapV2Router02Minimal(swapRouterAddress).swapExactTokensForTokens(_sushiHarvested, 1, path, address(this), block.timestamp);
        uint256 USDCafter = IERC20Upgradeable(baseToken).balanceOf(address(this));

        // distribute profit
        // process sushi fee if present
        uint256 sushiUSDC = USDCafter.sub(USDCbefore);
        if (treasuryFeeSushi > 0) {
            uint256 sushiFeeUSDC = sushiUSDC.mul(treasuryFeeSushi).div(1e20);
            /*feesUSDC*/treasurySushi = /*feesUSDC*/treasurySushi.add(sushiFeeUSDC);
            sushiUSDC = sushiUSDC.sub(sushiFeeUSDC);
        }

        bonusBalance = bonusBalance.add(sushiUSDC);

        if (totalStakedMoveEthLP > 0) {
            accBonusPerShareMoveEthLP = accBonusPerShareMoveEthLP.add(sushiUSDC.mul(1e24).div(totalStakedMoveEthLP));
        }

        emit ReceiveProfit(0, sushiUSDC);
    }

    function getTreasuryFees(uint256 _amount, address _receiver) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "finmgmt only");
        require(_amount <= /*feesUSDC*/treasurySushi, "amount exceeds balance");
        IERC20Upgradeable(baseToken).safeTransfer(_receiver, _amount);
        /*feesUSDC*/treasurySushi = /*feesUSDC*/treasurySushi.sub(_amount);
    }

    //function SetYieldAllocationTreshold(); // percentage of assets invested
    //function SetBaseAssetReserve(); // how much USDC should be present on this contract
    //function SetFetchLimit(); // sets maximum for requests of assets (to transfer to ETH subsidized execution wallets)

    //function claimInvestedFunds(); // internal for claiming yield-generating assets if burn compensation exceeds reserves
    //function FetchAssetsForGasSubsidy();
    //function RebalanceAssets();

    //function ReceiveETH(); -- refill with ETH -- do we need this function? refill with USDC, fill ETH directly on exec. wallet
    //                          can reclaim USDC that was excess through emergencyReclaim

    //function movePerLP() public view returns(uint256) {
    //    return IERC20Upgradeable(tokenMoveAddress).balanceOf(tokenMoveEthLPAddress).mul(1e18).div(IERC20Upgradeable(tokenMoveEthLPAddress).totalSupply());
    //}
}
