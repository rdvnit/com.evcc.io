'use strict';

function getDevice(homey, deviceId) {
  const driver = homey.drivers.getDriver('loadpoint');
  const device = driver.getDevices().find((candidate) => candidate.getId() === deviceId);
  if (!device) throw new Error('Charging point not found');
  return device;
}

function formatRemaining(seconds) {
  const value = Math.round(Number(seconds) || 0);
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return { value: '0', unit: 'm' };
  const h = Math.floor(value / 3600);
  const m = Math.round((value % 3600) / 60);
  if (h > 0) return { value: `${h}:${String(m).padStart(2, '0')}`, unit: null };
  return { value: String(m), unit: 'm' };
}

async function getState(device) {
  const lp = await device._poll();
  const connected = Boolean(device.getCapabilityValue('evcc_connected'));
  const soc = device.getCapabilityValue('measure_battery');
  const sessionEnergy = device.getCapabilityValue('meter_power');
  const power = device.getCapabilityValue('measure_power');
  const reportedCharging = Boolean(device.getCapabilityValue('evcc_charging'));
  const targetSoc = device.getCapabilityValue('evcc_target_soc');
  const charging = connected && typeof power === 'number' && power > 0;
  const paused = connected && reportedCharging && !charging;
  const smartModeSchema = Boolean(lp && lp.smartModeSchema);
  const mode = smartModeSchema
    ? lp.mode
    : device.getCapabilityValue('evcc_charge_mode') || 'off';

  return {
    name: device.getName(),
    available: device.getAvailable(),
    connected,
    charging,
    paused,
    status: charging ? 'Charging…' : paused ? 'Paused' : connected ? 'Connected' : 'Disconnected',
    soc: typeof soc === 'number' ? soc : null,
    targetSoc: typeof targetSoc === 'number' ? Math.round(targetSoc * 100) : null,
    sessionEnergy: typeof sessionEnergy === 'number' ? sessionEnergy : 0,
    power: typeof power === 'number' ? power : 0,
    phases: lp && typeof lp.phasesActive === 'number' ? lp.phasesActive : null,
    remaining: lp && typeof lp.chargeRemainingDuration === 'number' ? formatRemaining(lp.chargeRemainingDuration) : null,
    mode,
    modes: smartModeSchema
      ? [
        { id: 'off', label: 'Off' },
        { id: 'smart', label: 'Smart' },
        { id: 'now', label: 'Fast' },
      ]
      : [
        { id: 'off', label: 'Off' },
        { id: 'pv', label: 'Solar' },
        { id: 'minpv', label: 'Min+Solar' },
        { id: 'now', label: 'Fast' },
      ],
    smartModeSchema,
    alwaysCharge: smartModeSchema ? lp.alwaysCharge : null,
    alwaysChargeSupported: smartModeSchema && Boolean(lp.alwaysChargeSupported),
  };
}

module.exports = {
  async getLoadpoint({ homey, query }) {
    return getState(getDevice(homey, query.deviceId));
  },

  async refresh({ homey, query }) {
    return getState(getDevice(homey, query.deviceId));
  },

  async setMode({ homey, query, body }) {
    const device = getDevice(homey, query.deviceId);
    const mode = body && body.mode;
    const allowedModes = device._prevState && device._prevState.smartModeSchema
      ? ['off', 'smart', 'now']
      : ['off', 'pv', 'minpv', 'now'];
    if (!allowedModes.includes(mode)) throw new Error('Unsupported charging mode');
    await device.setChargeMode(mode);
    return getState(device);
  },

  async setAlwaysCharge({ homey, query, body }) {
    const device = getDevice(homey, query.deviceId);
    const state = body && body.state;
    await device.setAlwaysCharge(state);
    return getState(device);
  },
};
