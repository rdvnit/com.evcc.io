'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const EvccApi = require('../lib/EvccApi');
const { normalizeLoadpoint } = require('../lib/normalize');
const fs = require('node:fs');

const deviceSource = fs.readFileSync('drivers/loadpoint/device.js', 'utf8');

test('detects legacy evcc by absence of alwaysCharge', () => {
  const lp = normalizeLoadpoint({ mode: 'minpv' }, 1);

  assert.equal(lp.smartModeSchema, false);
  assert.equal(lp.homeyMode, 'minpv');
  assert.equal(lp.alwaysCharge, null);
  assert.equal(lp.alwaysChargeSupported, false);
});

test('detects redesigned evcc by presence of alwaysCharge', () => {
  const lp = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'once' }, 1);

  assert.equal(lp.smartModeSchema, true);
  assert.equal(lp.homeyMode, 'minpv');
  assert.equal(lp.alwaysCharge, 'once');
  assert.equal(lp.alwaysChargeSupported, true);
});

test('does not offer always charge for switchable or continuous devices', () => {
  const switchable = normalizeLoadpoint({
    mode: 'smart', alwaysCharge: 'off', chargerFeatureSwitchDevice: true,
  }, 1);
  const continuous = normalizeLoadpoint({
    mode: 'smart', alwaysCharge: 'off', chargerFeatureContinuous: true,
  }, 1);

  assert.equal(switchable.alwaysChargeSupported, false);
  assert.equal(continuous.alwaysChargeSupported, false);
});

test('maps Smart state into the fixed legacy Homey capability safely', () => {
  const smart = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'off' }, 1);
  const continuous = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'on' }, 1);

  assert.equal(smart.homeyMode, 'pv');
  assert.equal(continuous.homeyMode, 'minpv');
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