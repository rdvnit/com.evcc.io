'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const widgetApi = require('../widgets/evcc-loadpoint/api');

function createHomey(capabilities, lp = {}, calls = []) {
  const device = {
    getId: () => 'loadpoint-1',
    getName: () => 'Driveway',
    getAvailable: () => true,
    getCapabilityValue: (capability) => capabilities[capability],
    _poll: async () => { calls.push('poll'); return lp; },
    _prevState: lp,
    setChargeMode: async (mode) => { calls.push(`mode:${mode}`); lp.mode = mode; return lp; },
    setAlwaysCharge: async (state) => { calls.push(`always:${state}`); lp.alwaysCharge = state; return lp; },
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

test('keeps legacy mode controls when alwaysCharge is absent', async () => {
  const homey = createHomey({ evcc_charge_mode: 'minpv' }, { mode: 'minpv' });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.smartModeSchema, false);
  assert.equal(state.mode, 'minpv');
  assert.deepEqual(state.modes.map(({ id }) => id), ['off', 'pv', 'minpv', 'now']);
  assert.equal(state.alwaysCharge, null);
});

test('uses Smart controls when alwaysCharge is present', async () => {
  const lp = {
    mode: 'smart',
    smartModeSchema: true,
    alwaysCharge: 'once',
    alwaysChargeValid: true,
    alwaysChargeSupported: true,
  };
  const homey = createHomey({ evcc_charge_mode: 'minpv' }, lp);

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.mode, 'smart');
  assert.deepEqual(state.modes.map(({ id }) => id), ['off', 'smart', 'now']);
  assert.equal(state.alwaysCharge, 'once');
  assert.equal(state.alwaysChargeSupported, true);
});

test('uses heating labels and Always heat semantics for continuous loadpoints', async () => {
  const lp = {
    mode: 'smart',
    smartModeSchema: true,
    alwaysCharge: 'on',
    alwaysChargeValid: true,
    alwaysChargeSupported: true,
    continuous: true,
    switchDevice: false,
  };
  const homey = createHomey({ evcc_charge_mode: 'smart' }, lp);

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.deepEqual(state.modes.map(({ label }) => label), ['Normal', 'Smart', 'Boost']);
  assert.equal(state.alwaysChargeLabel, 'Always heat');
});

test('sets redesigned mode and always charge through separate handlers', async () => {
  const lp = {
    mode: 'off',
    smartModeSchema: true,
    alwaysCharge: 'off',
    alwaysChargeValid: true,
    alwaysChargeSupported: true,
  };
  const homey = createHomey({ evcc_charge_mode: 'pv' }, lp);

  const modeState = await widgetApi.setMode({
    homey,
    query: { deviceId: 'loadpoint-1' },
    body: { mode: 'smart' },
  });
  const alwaysState = await widgetApi.setAlwaysCharge({
    homey,
    query: { deviceId: 'loadpoint-1' },
    body: { state: 'once' },
  });

  assert.equal(modeState.mode, 'smart');
  assert.equal(alwaysState.alwaysCharge, 'once');
});

test('write endpoints render their authoritative snapshot without a second poll', async () => {
  const calls = [];
  const lp = {
    mode: 'off',
    smartModeSchema: true,
    alwaysCharge: 'off',
    alwaysChargeValid: true,
    alwaysChargeSupported: true,
  };
  const homey = createHomey({ evcc_charge_mode: 'off' }, lp, calls);

  await widgetApi.setMode({
    homey,
    query: { deviceId: 'loadpoint-1' },
    body: { mode: 'smart' },
  });
  await widgetApi.setAlwaysCharge({
    homey,
    query: { deviceId: 'loadpoint-1' },
    body: { state: 'on' },
  });

  assert.deepEqual(calls, ['mode:smart', 'always:on']);
});

test('disables Always charge in widget state when upstream value is invalid', async () => {
  const homey = createHomey({ evcc_charge_mode: 'smart' }, {
    mode: 'smart',
    smartModeSchema: true,
    alwaysCharge: null,
    alwaysChargeValid: false,
    alwaysChargeSupported: true,
  });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.equal(state.alwaysCharge, null);
  assert.equal(state.alwaysChargeSupported, false);
});

test('uses On for redesigned switch devices and exposes no Always charge control', async () => {
  const homey = createHomey({ evcc_charge_mode: 'smart' }, {
    mode: 'smart',
    smartModeSchema: true,
    alwaysCharge: 'off',
    alwaysChargeValid: true,
    alwaysChargeSupported: false,
    switchDevice: true,
  });

  const state = await widgetApi.getLoadpoint({ homey, query: { deviceId: 'loadpoint-1' } });

  assert.deepEqual(state.modes.map(({ label }) => label), ['Off', 'Smart', 'On']);
  assert.equal(state.alwaysChargeSupported, false);
});
