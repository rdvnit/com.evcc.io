'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeState } = require('../lib/normalize');

test('detects battery when evcc returns a battery dict with power (demo format)', () => {
  const raw = {
    pv: [{ power: 2600 }],
    grid: { power: 4700 },
    homePower: 400,
    battery: { power: 1000, capacity: 13.4, soc: 95, devices: [{ name: 'battery', power: 1000, soc: 95 }] },
    loadpoints: [],
  };

  const { site } = normalizeState(raw);
  assert.equal(site.batteryConfigured, true);
  assert.equal(site.batteryPower, 1000);
  assert.equal(site.batterySoc, 95);
});

test('detects battery when evcc returns top-level batteryPower number', () => {
  const raw = {
    pvPower: 2600,
    gridPower: 4700,
    homePower: 400,
    batteryPower: 1000,
    batterySoc: 95,
    loadpoints: [],
  };

  const { site } = normalizeState(raw);
  assert.equal(site.batteryConfigured, true);
  assert.equal(site.batteryPower, 1000);
  assert.equal(site.batterySoc, 95);
});

test('detects no battery when neither battery nor batteryPower present', () => {
  const raw = {
    pvPower: 2600,
    gridPower: 4700,
    homePower: 400,
    loadpoints: [],
  };

  const { site } = normalizeState(raw);
  assert.equal(site.batteryConfigured, false);
  assert.equal(site.batteryPower, null);
});
