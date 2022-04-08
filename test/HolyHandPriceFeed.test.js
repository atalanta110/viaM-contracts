// test/HolyHandPriceFeed.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

// Load compiled artifacts
const HolyHand = artifacts.require('HolyHandV4');
const PriceFeedMock = artifacts.require('PriceFeedMock');

contract('HolyHand (price feed)', function (accounts) {
  beforeEach(async function () {
    // account 0 is deployer address

    // deploy HolyHand
    this.holyhand = await deployProxy(HolyHand, { unsafeAllowCustomTypes: true, from: accounts[0] });
    this.pricemock = await deployProxy(PriceFeedMock, { unsafeAllowCustomTypes: true, from: accounts[0] });

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  it('HolyHand should be able to set price feed address', async function() {

    await truffleAssert.reverts(this.holyhand.setUSDCPriceFeed(this.pricemock.address, { from: accounts[3] }), "admin only");

    // test function, removed from contract
    // expect((await this.holyhand.priceCorrection(web3.utils.toBN('175000000'))).toString()).to.equal('175000000');
    
    await this.holyhand.setUSDCPriceFeed(this.pricemock.address, { from: accounts[0] });
    // test function, removed from contract
    // expect((await this.holyhand.priceCorrection(web3.utils.toBN('175000000'))).toString()).to.equal('175014443'); // rate is changed
  });
});