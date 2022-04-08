// migrations/27_upgrade_smarttreasuryV3.js
const SmartTreasuryV3 = artifacts.require('SmartTreasuryV3');
const SmartTreasuryV3_1 = artifacts.require('SmartTreasuryV3_1');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {

  let founderaddr = "";
  let STaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    STaddr = (await SmartTreasuryV3.deployed()).address;
  } else {
    founderaddr = accounts[0];
    STaddr = (await SmartTreasuryV3.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (STaddr == '') {
    throw("ERROR: no SmartTreasuryV2 address present to upgrade");
  }

  console.log("UPGRADING SMART TREASURY TO V3_1 at address " + STaddr + " IN network=" + network)
  
  const upgradedSTInstance = await upgradeProxy(STaddr, SmartTreasuryV3_1, { unsafeAllowCustomTypes: true });
  console.log('SmartTreasury upgraded to V3_1 at address: ', upgradedSTInstance.address);
  if (upgradedSTInstance.address != STaddr) {
      console.log('ERROR: SmartTreasury address changed during upgrade, this should not happen');
  }

  // aftercare:
  // - set sushiswap router address;
  // - set treasury sushi fee to 10%;
  // - claim pending sushi for test;
};
