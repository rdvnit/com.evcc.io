'use strict';

function getDevice(homey, deviceId) {
  const driver = homey.drivers.getDriver('loadpoint');
  const device = driver.getDevices().find((candidate) => candidate.getId() === deviceId);
  if (!device) throw new Error('Charging point not found');
  return device;
}

function getState(device) {
  const connected = Boolean(device.getCapabilityValue('evcc_connected'));
  const soc = device.getCapabilityValue('measure_battery');
  const sessionEnergy = device.getCapabilityValue('meter_power');
  const power = device.getCapabilityValue('measure_power');
  const reportedCharging = Boolean(device.getCapabilityValue('evcc_charging'));
  const charging = connected && typeof power === 'number' && power > 0;
  const paused = connected && reportedCharging && !charging;

  return {
    name: device.getName(),
    available: device.getAvailable(),
    connected,
    charging,
    paused,
    status: charging ? 'Charging…' : paused ? 'Paused' : connected ? 'Connected' : 'Disconnected',
    soc: typeof soc === 'number' ? soc : null,
    sessionEnergy: typeof sessionEnergy === 'number' ? sessionEnergy : 0,
    power: typeof power === 'number' ? power : 0,
    mode: device.getCapabilityValue('evcc_charge_mode') || 'off',
    modes: [
      { id: 'off', label: 'Off' },
      { id: 'pv', label: 'Solar' },
      { id: 'minpv', label: 'Min+Solar' },
      { id: 'now', label: 'Fast' },
    ],
  };
}

module.exports = {
  async getLoadpoint({ homey, query }) {
    return getState(getDevice(homey, query.deviceId));
  },

  async setMode({ homey, query, body }) {
    const device = getDevice(homey, query.deviceId);
    const mode = body && body.mode;
    if (!['off', 'pv', 'minpv', 'now'].includes(mode)) throw new Error('Unsupported charging mode');
    await device.setChargeMode(mode);
    return { ...getState(device), mode };
  },

  async refresh({ homey, query }) {
    const device = getDevice(homey, query.deviceId);
    await device._poll();
    return getState(device);
  },
};
