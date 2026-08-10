'use strict';

const { calculateEnergyFlow } = require('../../lib/energy-flow');

function getDevice(homey, deviceId) {
  const driver = homey.drivers.getDriver('site');
  const device = driver.getDevices().find((candidate) => candidate.getId() === deviceId);
  if (!device) throw new Error('evcc site not found');
  return device;
}

async function getState(device) {
  const { site, loadpoints } = await device._poll();
  const normalizedLoadpoints = loadpoints.map((lp) => ({
    ...lp,
    chargePower: typeof lp.chargePower === 'number' ? Math.round(lp.chargePower) : lp.chargePower,
    chargedEnergyWh: typeof lp.chargedEnergy === 'number' ? Math.round(lp.chargedEnergy * 1000) : null,
  }));

  return {
    name: device.getName(),
    available: device.getAvailable(),
    ...calculateEnergyFlow(site, normalizedLoadpoints),
  };
}

module.exports = {
  async getEnergyFlow({ homey, query }) {
    return getState(getDevice(homey, query.deviceId));
  },

  async refresh({ homey, query }) {
    return getState(getDevice(homey, query.deviceId));
  },
};
