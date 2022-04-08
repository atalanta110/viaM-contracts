// migrations/27_upgrade_smarttreasuryV3.js
const SmartTreasuryV2 = artifacts.require('SmartTreasuryV2');
const SmartTreasuryV3 = artifacts.require('SmartTreasuryV3');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {

  let founderaddr = "";
  let STaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    STaddr = (await SmartTreasuryV2.deployed()).address;
  } else {
    founderaddr = accounts[0];
    STaddr = (await SmartTreasuryV2.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (STaddr == '') {
    throw("ERROR: no SmartTreasuryV2 address present to upgrade");
  }

  console.log("UPGRADING SMART TREASURY TO V3 at address " + STaddr + " IN network=" + network)
  
  const upgradedSTInstance = await upgradeProxy(STaddr, SmartTreasuryV3, { unsafeAllowCustomTypes: true });
  console.log('SmartTreasury upgraded to V3 at address: ', upgradedSTInstance.address);
  if (upgradedSTInstance.address != STaddr) {
      console.log('ERROR: SmartTreasury address changed during upgrade, this should not happen');
  }

  // before migration:
  // - set treasury sushi fee to 0;
  // - claim all treasury pending sushi;
  // aftercare:
  // - set sushiswap router address;
  // - set treasury sushi fee to 10%;
  // - claim pending sushi for test;
};
