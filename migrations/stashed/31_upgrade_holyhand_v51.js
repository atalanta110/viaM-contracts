// migrations/30_upgrade_holyhandV5.js
const HolyHandV5 = artifacts.require('HolyHandV5');
const HolyHandV5_1 = artifacts.require('HolyHandV5_1');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyHandaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyHandaddr = (await HolyHandV5.deployed()).address;
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyHandaddr = (await HolyHandV5.deployed()).address;
  } else {
    founderaddr = accounts[0];
    holyHandaddr = (await HolyHandV5.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyHandaddr == '') {
    throw("ERROR: no HolyHand address present to upgrade");
  }

  console.log("UPGRADING HOLYHAND TO V5_1 at address " + holyHandaddr + " IN network=" + network)
  
  const upgradedHolyHandInstance = await upgradeProxy(holyHandaddr, HolyHandV5_1, { unsafeAllowCustomTypes: true });
  console.log('HolyHand upgraded at address: ', upgradedHolyHandInstance.address);
  if (upgradedHolyHandInstance.address != holyHandaddr) {
      console.log('ERROR: HolyHand address changed during upgrade, this should not happen');
  }

  // HolyHand upgrade v5_1 requires no maintenance calls after upgrade (optional topup token and address setup)
};
