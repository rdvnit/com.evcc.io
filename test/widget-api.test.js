'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const widgetApi = require('../widgets/evcc-loadpoint/api');

function createHomey(capabilities) {
  const device = {
    getId: () => 'loadpoint-1',
    getName: () => 'Driveway',
    getAvailable: () => true,
    getCapabilityValue: (capability) => capabilities[capability],
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