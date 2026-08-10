'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const widgetApi = require('../widgets/evcc-loadpoint/api');

function createHomey(capabilities, lp = {}) {
  const device = {
    getId: () => 'loadpoint-1',
    getName: () => 'Driveway',
    getAvailable: () => true,
    getCapabilityValue: (capability) => capabilities[capability],
    _poll: async () => lp,
  };

  return {
    drivers: {
      getDriver: () => ({ getDevices: () => [device] }),
    },
  };
}

test('reports paused when evcc still flags charging but power is zero', async () => {
  const homey = createHomey({
    evcc_connected: true,
    evcc_charging: true,
    measure_battery: 80,
    meter_power: 18.4,
    measure_power: 0,
    evcc_charge_mode: 'pv',
  });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.status, 'Paused');
  assert.equal(state.charging, false);
  assert.equal(state.paused, true);
  assert.equal(state.soc, 80);
});

test('reports charging only while power is flowing', async () => {
  const homey = createHomey({
    evcc_connected: true,
    evcc_charging: true,
    measure_battery: 80,
    meter_power: 18.4,
    measure_power: 7200,
    evcc_charge_mode: 'now',
  });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.status, 'Charging…');
  assert.equal(state.charging, true);
  assert.equal(state.paused, false);
});

test('uses live power when the charging capability is stale', async () => {
  const homey = createHomey({
    evcc_connected: true,
    evcc_charging: false,
    measure_battery: 80,
    meter_power: 18.4,
    measure_power: 7200,
    evcc_charge_mode: 'now',
  });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.status, 'Charging…');
  assert.equal(state.charging, true);
  assert.equal(state.paused, false);
});

test('exposes active phases and remaining charge time from the loadpoint poll', async () => {
  const homey = createHomey({
    evcc_connected: true,
    evcc_charging: true,
    measure_battery: 80,
    meter_power: 18.4,
    measure_power: 4200,
    evcc_charge_mode: 'now',
  }, {
    phasesActive: 3,
    chargeRemainingDuration: 5400,
  });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.phases, 3);
  assert.deepEqual(state.remaining, { value: '1:30', unit: null });
  assert.equal(state.sessionEnergy, 18.4);
});

test('reports target SoC as whole percent and zero remaining as 0m', async () => {
  const homey = createHomey({
    evcc_connected: true,
    evcc_charging: true,
    measure_battery: 60,
    meter_power: 18.4,
    measure_power: 4200,
    evcc_charge_mode: 'now',
    evcc_target_soc: 0.8,
  }, {
    phasesActive: 3,
    chargeRemainingDuration: 0,
  });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.targetSoc, 80);
  assert.deepEqual(state.remaining, { value: '0', unit: 'm' });
});

test('hides phases and remaining time when the loadpoint has no data', async () => {
  const homey = createHomey({
    evcc_connected: true,
    evcc_charging: false,
    measure_battery: 80,
    meter_power: 0,
    measure_power: 0,
    evcc_charge_mode: 'off',
  }, {
    phasesActive: null,
    chargeRemainingDuration: null,
  });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.phases, null);
  assert.equal(state.remaining, null);
});
