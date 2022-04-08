// migrations/32_upgrade_smarttreasuryV4.js
const SmartTreasuryV3_1 = artifacts.require('SmartTreasuryV3_1');
const SmartTreasuryV4 = artifacts.require('SmartTreasuryV4');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {

  let founderaddr = "";
  let STaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    STaddr = (await SmartTreasuryV3_1.deployed()).address;
  } else {
    founderaddr = accounts[0];
    STaddr = (await SmartTreasuryV3_1.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (STaddr == '') {
    throw("ERROR: no SmartTreasuryV3_1 address present to upgrade");
  }

  console.log("UPGRADING SMART TREASURY TO V4 at address " + STaddr + " IN network=" + network)
  
  const upgradedSTInstance = await upgradeProxy(STaddr, SmartTreasuryV4, { unsafeAllowCustomTypes: true });
  console.log('SmartTreasury upgraded to V4 at address: ', upgradedSTInstance.address);
  if (upgradedSTInstance.address != STaddr) {
      console.log('ERROR: SmartTreasury address changed during upgrade, this should not happen');
  }

  // aftercare:
  // - set endowment percent to 0 (probably, as endowment policy is not determined at the moment)
};
