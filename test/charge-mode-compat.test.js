'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const EvccApi = require('../lib/EvccApi');
const { normalizeLoadpoint } = require('../lib/normalize');
const fs = require('node:fs');

const deviceSource = fs.readFileSync('drivers/loadpoint/device.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
const loadpointFlows = JSON.parse(fs.readFileSync('drivers/loadpoint/driver.flow.compose.json', 'utf8'));
const chargeModeCapability = JSON.parse(fs.readFileSync('.homeycompose/capabilities/evcc_charge_mode.json', 'utf8'));
const alwaysChargeCapability = JSON.parse(fs.readFileSync('.homeycompose/capabilities/evcc_always_charge.json', 'utf8'));

test('detects legacy evcc by absence of alwaysCharge', () => {
  const lp = normalizeLoadpoint({ mode: 'minpv' }, 1);

  assert.equal(lp.smartModeSchema, false);
  assert.equal(lp.mode, 'minpv');
  assert.equal(lp.legacyMode, 'minpv');
  assert.equal(lp.alwaysCharge, null);
  assert.equal(lp.alwaysChargeSupported, false);
});

test('detects redesigned evcc by presence of alwaysCharge', () => {
  const lp = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'once' }, 1);

  assert.equal(lp.smartModeSchema, true);
  assert.equal(lp.mode, 'smart');
  assert.equal(lp.legacyMode, 'minpv');
  assert.equal(lp.alwaysCharge, 'once');
  assert.equal(lp.alwaysChargeSupported, true);
});

test('offers always charge for continuous devices but not switch devices', () => {
  const switchable = normalizeLoadpoint({
    mode: 'smart', alwaysCharge: 'off', chargerFeatureSwitchDevice: true,
  }, 1);
  const continuous = normalizeLoadpoint({
    mode: 'smart', alwaysCharge: 'off', chargerFeatureContinuous: true,
  }, 1);

  assert.equal(switchable.alwaysChargeSupported, false);
  assert.equal(continuous.alwaysChargeSupported, true);
  assert.equal(continuous.continuous, true);
  assert.equal(switchable.switchDevice, true);
});

test('keeps raw Smart state and derives legacy aliases only for old Flows', () => {
  const smart = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'off' }, 1);
  const continuous = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'on' }, 1);

  assert.equal(smart.mode, 'smart');
  assert.equal(continuous.mode, 'smart');
  assert.equal(smart.legacyMode, 'pv');
  assert.equal(continuous.legacyMode, 'minpv');
});

test('does not invent an Always charge value or legacy alias for malformed upstream state', () => {
  for (const raw of [undefined, null, false, 'invalid']) {
    const lp = normalizeLoadpoint({ mode: 'smart', alwaysCharge: raw }, 1);
    assert.equal(lp.smartModeSchema, true);
    assert.equal(lp.alwaysCharge, null);
    assert.equal(lp.alwaysChargeValid, false);
    assert.equal(lp.legacyMode, null);
  }
});

test('rejects invalid read modes instead of manufacturing authoritative state', () => {
  for (const mode of [undefined, null, 'broken', 'pv', 'minpv']) {
    assert.throws(
      () => normalizeLoadpoint({ mode, alwaysCharge: 'off' }, 1),
      /Invalid evcc loadpoint mode/,
    );
  }
  for (const mode of [undefined, null, 'broken', 'smart']) {
    assert.throws(
      () => normalizeLoadpoint({ mode }, 1),
      /Invalid evcc loadpoint mode/,
    );
  }
});

test('Homey capabilities can represent canonical evcc mode and Always charge state', () => {
  assert.deepEqual(chargeModeCapability.values.map(({ id }) => id), ['off', 'smart', 'now', 'pv', 'minpv']);
  assert.deepEqual(alwaysChargeCapability.values.map(({ id }) => id), ['off', 'on', 'once']);
  assert.match(deviceSource, /_safeSet\('evcc_charge_mode', lp\.mode\)/);
  assert.match(deviceSource, /addCapability\('evcc_always_charge'\)/);
  assert.match(deviceSource, /setCapabilityOptions\('evcc_charge_mode'/);
});

test('uses the proposed evcc always-charge endpoint', async () => {
  const api = new EvccApi({ host: 'http://evcc.local' });
  let request;
  api._request = async (method, path) => { request = { method, path }; };

  await api.setLoadpointAlwaysCharge(2, 'once');

  assert.deepEqual(request, {
    method: 'POST',
    path: '/loadpoints/2/alwayscharge/once',
  });
});

test('mode changes do not clear the separate Always charge preference', () => {
  const setChargeMode = deviceSource.match(/async setChargeMode\(mode\) \{([\s\S]*?)\n  \}/)[1];

  assert.match(setChargeMode, /setLoadpointMode/);
  assert.doesNotMatch(setChargeMode, /setLoadpointAlwaysCharge/);
});

test('legacy Flow aliases are handled at the Flow boundary only', () => {
  const flowModes = ['off', 'smart', 'now', 'pv', 'minpv'];
  for (const card of [
    loadpointFlows.triggers.find(({ id }) => id === 'charge_mode_changed'),
    loadpointFlows.conditions.find(({ id }) => id === 'charge_mode_is'),
    loadpointFlows.actions.find(({ id }) => id === 'set_charge_mode'),
  ]) {
    assert.deepEqual(card.args[0].values.map(({ id }) => id), flowModes);
  }
  assert.match(appSource, /args\.device\.isChargeMode\(args\.mode\)/);
  assert.match(deviceSource, /isChargeMode\(mode\)/);
  assert.match(appSource, /args\.mode === state\.mode/);
  assert.match(appSource, /args\.state === state\.state/);
});

test('adds separate Always charge Flow cards without replacing existing charge-mode cards', () => {
  assert.ok(loadpointFlows.triggers.some(({ id }) => id === 'charge_mode_changed'));
  assert.ok(loadpointFlows.conditions.some(({ id }) => id === 'charge_mode_is'));
  assert.ok(loadpointFlows.actions.some(({ id }) => id === 'set_charge_mode'));

  const trigger = loadpointFlows.triggers.find(({ id }) => id === 'always_charge_changed');
  const condition = loadpointFlows.conditions.find(({ id }) => id === 'always_charge_is');
  const action = loadpointFlows.actions.find(({ id }) => id === 'set_always_charge');
  const states = ['off', 'on', 'once'];

  assert.deepEqual(trigger.args[0].values.map(({ id }) => id), states);
  assert.deepEqual(condition.args[0].values.map(({ id }) => id), states);
  assert.deepEqual(action.args[0].values.map(({ id }) => id), states);
  assert.match(appSource, /getActionCard\('set_always_charge'\)/);
  assert.match(appSource, /getConditionCard\('always_charge_is'\)/);
  assert.match(deviceSource, /getDeviceTriggerCard\('always_charge_changed'\)/);
});
