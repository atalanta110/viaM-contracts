// test/SmartTreasuryPWC.test.js

const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');
const ether = require('@openzeppelin/test-helpers/src/ether');

const SmartTreasury = artifacts.require('SmartTreasuryV2');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockDAI = artifacts.require('ERC20DAIMock');
const MoverToken = artifacts.require('MoverToken');
const HolyHandV3 = artifacts.require('HolyHandV3');
const SmartTreasuryFragmentPWC = artifacts.require('SmartTreasuryFragmentPWC');
const RaribleToken = artifacts.require('RaribleToken');

contract('SmartTreasury V2 (gas checks)', function (accounts) {
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

    this.hh = await deployProxy(HolyHandV3, { unsafeAllowCustomTypes: true, from: accounts[0] });

    await this.st.grantRole.sendTransaction(web3.utils.sha3("EXECUTOR_ROLE"), this.hh.address, { from: accounts[0] });
    await this.st.grantRole.sendTransaction(web3.utils.sha3("FINMGMT_ROLE"), accounts[0], { from: accounts[0] });
    await this.hh.setSmartTreasury.sendTransaction(this.st.address, { from: accounts[0] });
    await this.hh.setTreasuryTokens.sendTransaction(this.mover.address, this.movelpmock.address, { from: accounts[0] });
    await time.advanceBlock();
  });

  // stake/unstake MOVE token and perform claim & burn on some tokens
  it('gas measurements for receiveProfit call', async function() {

    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
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

    // provide ST some yield to distribute
    let gas_before = await web3.eth.getBalance(accounts[0]);
    let tx = await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    //console.log("TX", tx.tx);
    let receipt = await web3.eth.getTransactionReceipt(tx.tx);
    //console.log("receipt", receipt);
    let gasPrice = web3.utils.toBN('20000000000' /*receipt.gasPrice*/);
    let gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to call receiveProfit (only MOVE staked, no LP): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());


    await this.movelpmock.transfer.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('2000000'), { from: accounts[1] });


    gas_before = await web3.eth.getBalance(accounts[0]);
    tx = await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    receipt = await web3.eth.getTransactionReceipt(tx.tx);
    gas_after = await web3.eth.getBalance(accounts[0]);
    console.log("Gas used to call receiveProfit (MOVE + LP staked): " + (web3.utils.toBN(gas_before).sub(web3.utils.toBN(gas_after)).div(gasPrice)).toString());



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
});
