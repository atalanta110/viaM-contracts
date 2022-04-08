// test/SmartTreasuryPWC.test.js

const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');
const ether = require('@openzeppelin/test-helpers/src/ether');

const MockUSDC = artifacts.require('ERC20USDCMock');
const MockDAI = artifacts.require('ERC20DAIMock');
const MoverToken = artifacts.require('MoverToken');
const HolyHandV3 = artifacts.require('HolyHandV3');
const SmartTreasuryFragmentPWC = artifacts.require('SmartTreasuryFragmentPWC');
const RaribleToken = artifacts.require('RaribleToken');
const SmartTreasury = artifacts.require('SmartTreasuryV2');
const SmartTreasuryV3 = artifacts.require('SmartTreasuryV3');

contract('SmartTreasury V3 (Powercard stake/unstake)', function (accounts) {
  beforeEach(async function () {
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    this.mover = await deployProxy(MoverToken, ["Mover", "MOVE"], { unsafeAllowCustomTypes: true, from: accounts[0] });
    // mock of DAI suits us (18 decimals) as simple ERC20 token
    this.movelpmock = await MockDAI.new(accounts[0], { from: accounts[0] });

    let gas_before = await web3.eth.getBalance(accounts[0]);
    this.st = await deployProxy(SmartTreasury, ["SmartTreasury", "STB", this.mockusdc.address, this.mover.address, this.movelpmock.address], { unsafeAllowCustomTypes: true, from: accounts[0] });
    await time.advanceBlock();
    let receipt = await web3.eth.getTransactionReceipt(this.st.transactionHash);
    //console.log("Receipt: ", receipt);
    const gasUsed = web3.utils.toBN(receipt.gasUsed);

    const tx = await web3.eth.getTransaction(this.st.transactionHash);
    const gasPrice = web3.utils.toBN(tx.gasPrice);
    console.log(`GasPrice: ` + gasPrice);


    let gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to deploy SmartTreasury contract (with proxies): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());
    //console.log("Gas used to deploy SmartTreasury contract: " + (gas_after.sub(gas_before).toString()));

    // upgrade ST to V3
    this.st = await upgradeProxy(this.st.address, SmartTreasuryV3, { unsafeAllowCustomTypes: true });

    this.hh = await deployProxy(HolyHandV3, { unsafeAllowCustomTypes: true, from: accounts[0] });

    await this.st.grantRole.sendTransaction(web3.utils.sha3("EXECUTOR_ROLE"), this.hh.address, { from: accounts[0] });
    await this.st.grantRole.sendTransaction(web3.utils.sha3("FINMGMT_ROLE"), accounts[0], { from: accounts[0] });
    await this.hh.setSmartTreasury.sendTransaction(this.st.address, { from: accounts[0] });
    await this.hh.setTreasuryTokens.sendTransaction(this.mover.address, this.movelpmock.address, { from: accounts[0] });
    await time.advanceBlock();

    // mint 21 PWC to account 0
    this.nft = await RaribleToken.new("Rarible", "RARI", accounts[1], "https://test", "https://test", { from: accounts[0] });
    await this.nft.mintDebug.sendTransaction(web3.utils.toBN('107150'), [], 21, "https://powercard", { from: accounts[0] });

    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);

    this.pwc = await deployProxy(SmartTreasuryFragmentPWC, { unsafeAllowCustomTypes: true, from: accounts[0] });
    await this.st.setPowercardFragment.sendTransaction(this.pwc.address, { from: accounts[0] });
    await this.pwc.setPowercardAddress.sendTransaction(this.nft.address, { from: accounts[0] });
    await this.pwc.setPowercardParams.sendTransaction(web3.utils.toBN('2592000'), web3.utils.toBN('5184000'), { from: accounts[0] });
  });

  // stake/unstake MOVE token and perform claim & burn on some tokens
  it('gas measurements, stake powercard NFT, require balance and allowance', async function() {
    // account[1] would deposit some tokens through transfer proxy
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('998000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('2000000');

    // provide ST some yield to distribute
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    // deposit some more MOVE, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    await this.st.setPowercardFragment.sendTransaction('0x0000000000000000000000000000000000000000', { from: accounts[0] });

    // provide ST some yield to distribute
    let gas_before = await web3.eth.getBalance(accounts[0]);
    let tx = await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    //console.log("TX", tx.tx);
    let receipt = await web3.eth.getTransactionReceipt(tx.tx);
    //console.log("receipt", receipt);
    let gasPrice = web3.utils.toBN('20000000000' /*receipt.gasPrice*/);
    let gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to call receiveProfit (no PWC): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());

    await this.st.setPowercardFragment.sendTransaction(this.pwc.address, { from: accounts[0] });

    gas_before = await web3.eth.getBalance(accounts[0]);
    tx = await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    //console.log("TX", tx.tx);
    receipt = await web3.eth.getTransactionReceipt(tx.tx);
    //console.log("receipt", receipt);
    gasPrice = web3.utils.toBN('20000000000' /*receipt.gasPrice*/);
    gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to call receiveProfit (with PWC enabled): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());

    expect((await this.nft.balanceOf(accounts[0], web3.utils.toBN('107150'))).toString()).to.equal('21');

    await this.nft.safeTransferFrom(accounts[0], accounts[1], web3.utils.toBN('107150'), 1, [], { from: accounts[0] });
    
    // staking of PWC should revert if allowance is not set
    await truffleAssert.reverts(this.pwc.stakePowercard.sendTransaction({ from: accounts[1] }), "Need operator approval for 3rd party transfers.");
    
    // staking of PWC should revert if it's not on the balance
    await this.nft.setApprovalForAll.sendTransaction(this.pwc.address, true, { from: accounts[9] });
    await truffleAssert.reverts(this.pwc.stakePowercard.sendTransaction({ from: accounts[9] }), "revert");

    await this.nft.setApprovalForAll.sendTransaction(this.pwc.address, true, { from: accounts[1] });

    await this.pwc.stakePowercard.sendTransaction({ from: accounts[1] });

    expect((await this.nft.balanceOf(accounts[0], web3.utils.toBN('107150'))).toString()).to.equal('20');
    expect((await this.nft.balanceOf(this.pwc.address, web3.utils.toBN('107150'))).toString()).to.equal('1');

    gas_before = await web3.eth.getBalance(accounts[0]);
    tx = await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    //console.log("TX", tx.tx);
    receipt = await web3.eth.getTransactionReceipt(tx.tx);
    //console.log("receipt", receipt);
    gasPrice = web3.utils.toBN('20000000000' /*receipt.gasPrice*/);
    gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to call receiveProfit (with 1 PWC staked): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('999');



    await this.nft.safeTransferFrom(accounts[0], accounts[2], web3.utils.toBN('107150'), 1, [], { from: accounts[0] });
    await this.nft.setApprovalForAll.sendTransaction(this.pwc.address, true, { from: accounts[2] });
    await this.pwc.stakePowercard.sendTransaction({ from: accounts[2] });
    gas_before = await web3.eth.getBalance(accounts[0]);
    tx = await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to call receiveProfit (with 2 PWC staked): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());


    await this.nft.safeTransferFrom(accounts[0], accounts[3], web3.utils.toBN('107150'), 1, [], { from: accounts[0] });
    await this.nft.setApprovalForAll.sendTransaction(this.pwc.address, true, { from: accounts[3] });
    await this.pwc.stakePowercard.sendTransaction({ from: accounts[3] });
    gas_before = await web3.eth.getBalance(accounts[0]);
    tx = await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to call receiveProfit (with 3 PWC staked): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());

    await time.increase(web3.utils.toBN('2592000'));
    await time.advanceBlock();

    gas_before = await web3.eth.getBalance(accounts[0]);
    tx = await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to call receiveProfit (with 3 PWC cooldown, repeat): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());


    /*
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');

    // transfer some move tokens to accounts[2], who would perform claim & burn
    // total supply of MOVE tokens is 1000000000000
    await this.mover.transfer.sendTransaction(accounts[2], web3.utils.toBN('500000000'), { from: accounts[1] }); // 50% of total MOVE supply
    // burn of 20% of supply should fail due to max burn limit
    await truffleAssert.reverts(this.st.claimAndBurnOnBehalf(accounts[2], web3.utils.toBN('500000000'), { from: accounts[2] }), "executor only");
    await truffleAssert.reverts(this.hh.claimAndBurn(web3.utils.toBN('50000'), { from: accounts[2] }), "burn amount exceeds allowance");
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('500000000'), { from: accounts[2] });
    expect((await this.st.maxBurnAmount()).toString()).to.equal('100000000');
    expect((await this.st.getBurnValuePortions(accounts[2], web3.utils.toBN('50000000')))[0].toString()).to.equal('300');
    expect((await this.st.getBurnValuePortions(accounts[2], web3.utils.toBN('50000000')))[1].toString()).to.equal('0');
    
    await truffleAssert.reverts(this.hh.claimAndBurn(web3.utils.toBN('500000000'), { from: accounts[2] }), "max amount exceeded");
    // burn 5% (1/20) of total supply, receive 5% * 4 = 20% of total endowment USDC 
    await this.hh.claimAndBurn(web3.utils.toBN('50000000'), { from: accounts[2] });

    // withdraw full amount, this should trigger receiving of bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('500000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1200'); //  1500 * 0.8 = 1200
    // account 2 should have 300 USDC, total supply should be lower
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('450000000');
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('2700');
    expect((await this.mockusdc.balanceOf(accounts[2])).toString()).to.equal('300');
    expect((await this.mover.totalSupply()).toString()).to.equal('950000000');
    */
  });


  // not allow to stake 2 powercards
  // not allow to unstake if not staked
  // not allow to unstake during active period
  // allow to unstake during cooldown
  // not allow to stake after unstake during cooldown
  // allow to stake after unstake and cooldown
  it('should not allow to stake 2 powercards, to unstake if not staked/during active period, etc.', async function() {
    // account[1] would deposit some tokens through transfer proxy
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('998000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('2000000');

    // provide ST some yield to distribute
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    // deposit some more MOVE, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });    

    expect((await this.nft.balanceOf(accounts[0], web3.utils.toBN('107150'))).toString()).to.equal('21');

    await this.nft.safeTransferFrom(accounts[0], accounts[1], web3.utils.toBN('107150'), 1, [], { from: accounts[0] });
    
    
    await this.nft.setApprovalForAll.sendTransaction(this.pwc.address, true, { from: accounts[1] });

    await this.pwc.stakePowercard.sendTransaction({ from: accounts[1] });

    // should not be able to unstake if not staked
    await truffleAssert.reverts(this.pwc.unstakePowercard.sendTransaction({ from: accounts[2] }), "not staked");

    // should not be able to stake twice
    await truffleAssert.reverts(this.pwc.stakePowercard.sendTransaction({ from: accounts[1] }), "already staked");

    expect((await this.nft.balanceOf(accounts[0], web3.utils.toBN('107150'))).toString()).to.equal('20');
    expect((await this.nft.balanceOf(this.pwc.address, web3.utils.toBN('107150'))).toString()).to.equal('1');

    await time.increase(web3.utils.toBN('1292000')); // around 50% of active period
    await time.advanceBlock();

    // should not be able to unstake if active
    await truffleAssert.reverts(this.pwc.unstakePowercard.sendTransaction({ from: accounts[1] }), "only on cooldown");

    let activeStakers = await this.pwc.getActiveNFTstakers();
    expect(activeStakers[1].toString()).to.equal('1');
    expect(activeStakers[0][0].toString()).to.equal(accounts[1].toString());

    await time.increase(web3.utils.toBN('1352000')); // a bit more than 50% of active period, now on cooldown
    await time.advanceBlock();

    // should be able to unstake on cooldown
    await this.pwc.unstakePowercard.sendTransaction({ from: accounts[1] });

    expect((await this.nft.balanceOf(accounts[0], web3.utils.toBN('107150'))).toString()).to.equal('20');
    expect((await this.nft.balanceOf(this.pwc.address, web3.utils.toBN('107150'))).toString()).to.equal('0');
    expect((await this.nft.balanceOf(accounts[1], web3.utils.toBN('107150'))).toString()).to.equal('1');

    await time.increase(web3.utils.toBN('52000')); // a small period of time, still on cooldown
    await time.advanceBlock();

    // should not be able to stake from same address during cooldown
    await truffleAssert.reverts(this.pwc.stakePowercard.sendTransaction({ from: accounts[1] }), "recently unstaked cooldown");

    await time.increase(web3.utils.toBN('5200000')); // cooldown passed, can be staked again
    await time.advanceBlock();

    //let nft_stake = await this.pwc.nft_stakes(0);
    //console.log("NFT stake", nft_stake);

    // allow to stake after cooldown
    //await this.nft.setApprovalForAll.sendTransaction(this.pwc.address, true, { from: accounts[1] });
    await this.pwc.stakePowercard.sendTransaction({ from: accounts[1] });

    expect((await this.nft.balanceOf(accounts[0], web3.utils.toBN('107150'))).toString()).to.equal('20');
    expect((await this.nft.balanceOf(this.pwc.address, web3.utils.toBN('107150'))).toString()).to.equal('1');
    expect((await this.nft.balanceOf(accounts[1], web3.utils.toBN('107150'))).toString()).to.equal('0');
  });

  // provide corrent switching between active and cooldown status
  // provide correct values of active and cooldown times remaining
  it('should switch between active/cooldown status and correct values of times remaining', async function() {
    // account[1] would deposit some tokens through transfer proxy
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('998000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('2000000');

    // provide ST some yield to distribute
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    // deposit some more MOVE, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });    

    expect((await this.nft.balanceOf(accounts[0], web3.utils.toBN('107150'))).toString()).to.equal('21');

    await this.nft.safeTransferFrom(accounts[0], accounts[1], web3.utils.toBN('107150'), 1, [], { from: accounts[0] });
    
    
    await this.nft.setApprovalForAll.sendTransaction(this.pwc.address, true, { from: accounts[1] });
    await this.pwc.stakePowercard.sendTransaction({ from: accounts[1] });

    var timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('1292000'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('1299000'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('998'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('1'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('1'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('998'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('2500000'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('2500000'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('183000'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('1'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('1'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('1000'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await time.increase(web3.utils.toBN('100000'));
    await time.advanceBlock();

    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());
  });

  // provide multiplicating effect on yield distribution
  // account 1 stakes 1000000 MOVE and PowerCard
  // account 2 stakes 1000000 MOVE
  it('should affect distribution of bonuses when PWC is active', async function() {
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });
    await this.hh.depositToTreasury(web3.utils.toBN('1000000'), web3.utils.toBN('0'), { from: accounts[1] });

    await this.mover.mint.sendTransaction(accounts[2], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });
    await this.hh.depositToTreasury(web3.utils.toBN('1000000'), web3.utils.toBN('0'), { from: accounts[2] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('1000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('999000000');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('1000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');

    // provide ST 1000 USDC yield to distribute
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1] and accounts[2]
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('250');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('250');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('250');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('250');

    // stake NFT
    expect((await this.nft.balanceOf(accounts[0], web3.utils.toBN('107150'))).toString()).to.equal('21');
    await this.nft.safeTransferFrom(accounts[0], accounts[1], web3.utils.toBN('107150'), 1, [], { from: accounts[0] });
    await this.nft.setApprovalForAll.sendTransaction(this.pwc.address, true, { from: accounts[1] });
    await this.pwc.stakePowercard.sendTransaction({ from: accounts[1] });

    var timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    // provide ST 2000 USDC yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');
    // PWC is active for accounts[1], so he receives 2/3 of 1000 that goes to bonuses
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');   // 1000 + 500
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('583'); // 250 + 333
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('915');  // 250 + 333 + 332 minted
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('583'); // 250 + 333
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('583'); // 250 + 333

    // increase time
    await time.increase(web3.utils.toBN('2600000'));
    await time.advanceBlock();
    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    // PWC is in cooldown
    // provide ST 2000 USDC yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('5000');
    // PWC is inctive for accounts[1], so he receives 1/2 of 1000 that goes to bonuses
    expect((await this.st.endowmentBalance()).toString()).to.equal('2500'); // +1000
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1083'); // +500
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1415');  // +500
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('1083'); // +500
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('1083'); // +500

    // increase time
    await time.increase(web3.utils.toBN('5200000'));
    await time.advanceBlock();
    timings = await this.pwc.getRemainingTimings(accounts[1], { from: accounts[1] });
    console.log("Timings: active=" + timings[0].toString() + ", cooldown=" + timings[1].toString());

    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('7000');
    // PWC is active for accounts[1], so he receives 2/3 of 1000 that goes to bonuses
    expect((await this.st.endowmentBalance()).toString()).to.equal('3500'); // +1000
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1417'); // 1083 + 334
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('2081');  // 1415 + 333 + 333 minted
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('1417'); // 1083 + 334
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('1417'); // 1083 + 334
  });

});
