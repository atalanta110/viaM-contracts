// test/SmartTreasury.claimburn.test.js

const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');
const ether = require('@openzeppelin/test-helpers/src/ether');

const SmartTreasury = artifacts.require('SmartTreasuryV2');
const SmartTreasuryV3 = artifacts.require('SmartTreasuryV3');
const SmartTreasuryV4 = artifacts.require('SmartTreasuryV4');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockDAI = artifacts.require('ERC20DAIMock');
const MoverToken = artifacts.require('MoverToken');
const HolyHandV3 = artifacts.require('HolyHandV3');

contract('SmartTreasury (MOBO to USDC)', function (accounts) {
  beforeEach(async function () {
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    this.mover = await deployProxy(MoverToken, ["Mover", "MOVE"], { from: accounts[0] });
    // mock of DAI suits us (18 decimals) as simple ERC20 token
    this.movelpmock = await MockDAI.new(accounts[0], { from: accounts[0] });

    this.st = await deployProxy(SmartTreasury, ["SmartTreasury", "STB", this.mockusdc.address, this.mover.address, this.movelpmock.address], { from: accounts[0] });
    await time.advanceBlock();

    // upgrade ST to V3
    this.st = await upgradeProxy(this.st.address, SmartTreasuryV3);
    // upgrade ST to V4
    this.st = await upgradeProxy(this.st.address, SmartTreasuryV4);

    this.hh = await deployProxy(HolyHandV3, { from: accounts[0] });

    await this.st.grantRole.sendTransaction(web3.utils.sha3("EXECUTOR_ROLE"), this.hh.address, { from: accounts[0] });
    await this.hh.setSmartTreasury.sendTransaction(this.st.address, { from: accounts[0] });
    await this.hh.setTreasuryTokens.sendTransaction(this.mover.address, this.movelpmock.address, { from: accounts[0] });
    await time.advanceBlock();
  });

  // stake/unstake MOVE token and perform USDC claim
  it('should allow to perform claim USDC, burning all pending and all of tokenized bonus', async function() {
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    // yield of 1000000 to treasury
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000000'), { from: accounts[0] });

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
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1001000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1000500');

    // deposit some more MOVE, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1000500');

    // provide ST some yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1003000');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1001500');

    // total supply of MOVE tokens is 1000000000
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });
    //expect((await this.st.maxBurnAmount()).toString()).to.equal('100000000');
    //expect((await this.st.getBurnValuePortions(accounts[1], web3.utils.toBN('2400000')))[0].toString()).to.equal('9612');
    //expect((await this.st.getBurnValuePortions(accounts[1], web3.utils.toBN('2400000')))[1].toString()).to.equal('1500'); // all bonuses pending + tokenized
    
    //await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('500000000'), { from: accounts[1] });
    await this.st.claimUSDCforBonus({ from: accounts[1] });

    // withdraw full amount, this should trigger receiving of bonus tokens
    expect((await this.mover.totalSupply()).toString()).to.equal('1000000000');
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('996000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('4000000');

    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('4000000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('0'); // 1000 pending + 500 tokens - 1201 = 299 tokens left
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('0');

    expect((await this.st.endowmentBalance()).toString()).to.equal('1001500'); // endowment is not affected
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1001500'); // 1003000 - 1500, all bonuses converted
    expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('1500');

    // yield of 100000 to treasury
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('100000'), { from: accounts[0] });

    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('50000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('50000');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1051500');
    expect((await this.st.bonusBalance()).toString()).to.equal('50000');

    await this.st.claimUSDCforBonus({ from: accounts[1] });
    await truffleAssert.reverts(this.st.claimUSDCforBonus({ from: accounts[2] }), "nothing to claim");

    expect((await this.st.endowmentBalance()).toString()).to.equal('1051500'); // endowment is not affected
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1051500');
    expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('51500');
    expect((await this.st.bonusBalance()).toString()).to.equal('0');

    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('0');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('0');
  });
});
