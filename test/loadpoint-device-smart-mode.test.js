'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { normalizeLoadpoint } = require('../lib/normalize');

const originalLoad = Module._load;
Module._load = function mockHomey(request, parent, isMain) {
  if (request === 'homey') return { Device: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const LoadpointDevice = require('../drivers/loadpoint/device');
Module._load = originalLoad;

function createQueuedDevice(state) {
  const device = Object.create(LoadpointDevice.prototype);
  device._operationQueue = Promise.resolve();
  device._loadpointIndex = 1;
  device._prevState = state;
  return device;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('serializes a background poll before a mode POST and its authoritative GET', async () => {
  const oldSnapshot = { mode: 'off' };
  const newSnapshot = { mode: 'smart' };
  const gate = deferred();
  const events = [];
  let getCount = 0;
  const device = createQueuedDevice({ smartModeSchema: true });
  device._pollOnce = async ({ throwOnError }) => {
    getCount += 1;
    events.push(`get-${getCount}-start:${throwOnError}`);
    if (getCount === 1) await gate.promise;
    events.push(`get-${getCount}-end`);
    return getCount === 1 ? oldSnapshot : newSnapshot;
  };
  device._api = {
    setLoadpointMode: async (index, mode) => events.push(`post:${index}:${mode}`),
  };

  const poll = device._poll();
  const write = device.setChargeMode('smart');
  await flushMicrotasks();
  assert.deepEqual(events, ['get-1-start:false']);

  gate.resolve();
  assert.strictEqual(await poll, oldSnapshot);
  assert.strictEqual(await write, newSnapshot);
  assert.deepEqual(events, [
    'get-1-start:false',
    'get-1-end',
    'post:1:smart',
    'get-2-start:true',
    'get-2-end',
  ]);
});

test('propagates post-write GET failure and self-heals the operation queue', async () => {
  const recovered = { mode: 'smart' };
  const events = [];
  let getCount = 0;
  const device = createQueuedDevice({ smartModeSchema: true });
  device._api = {
    setLoadpointMode: async () => events.push('post'),
  };
  device._pollOnce = async ({ throwOnError }) => {
    getCount += 1;
    events.push(`get:${throwOnError}`);
    if (getCount === 1) throw new Error('verification failed');
    return recovered;
  };

  await assert.rejects(device.setChargeMode('smart'), /verification failed/);
  assert.strictEqual(await device._poll(), recovered);
  assert.deepEqual(events, ['post', 'get:true', 'get:false']);
});

test('background polling returns null but the same GET failure rejects write verification', async () => {
  const events = [];
  const device = createQueuedDevice({ smartModeSchema: true });
  device._api = {
    getState: async () => { events.push('get'); throw new Error('evcc offline'); },
    setLoadpointMode: async () => events.push('post'),
  };
  device.error = () => {};
  device.setUnavailable = async () => events.push('unavailable');

  assert.equal(await device._poll(), null);
  await assert.rejects(device.setChargeMode('smart'), /evcc offline/);
  assert.deepEqual(events, ['get', 'unavailable', 'post', 'get', 'unavailable']);
});

test('validates mode writes against the queued detected schema and keeps redesigned aliases', async () => {
  const events = [];
  const snapshot = { mode: 'smart' };
  const redesigned = createQueuedDevice({ smartModeSchema: true });
  redesigned._api = {
    setLoadpointMode: async (_index, mode) => events.push(mode),
  };
  redesigned._pollOnce = async () => snapshot;

  assert.strictEqual(await redesigned.setChargeMode('pv'), snapshot);
  assert.deepEqual(events, ['pv']);

  const legacy = createQueuedDevice({ smartModeSchema: false });
  legacy._api = {
    setLoadpointMode: async (_index, mode) => events.push(mode),
  };
  legacy._pollOnce = async () => snapshot;
  await assert.rejects(legacy.setChargeMode('smart'), /detected evcc schema/);
  assert.deepEqual(events, ['pv']);
});

test('requires valid upstream Always charge state before writing', async () => {
  const events = [];
  const invalid = createQueuedDevice({
    smartModeSchema: true,
    alwaysChargeSupported: true,
    alwaysChargeValid: false,
  });
  invalid._api = {
    setLoadpointAlwaysCharge: async () => events.push('post'),
  };
  invalid._pollOnce = async () => ({ alwaysCharge: 'on' });

  await assert.rejects(invalid.setAlwaysCharge('on'), /state from evcc is invalid/);
  assert.deepEqual(events, []);

  invalid._prevState.alwaysChargeValid = true;
  const snapshot = await invalid.setAlwaysCharge('once');
  assert.deepEqual(snapshot, { alwaysCharge: 'on' });
  assert.deepEqual(events, ['post']);

  invalid._prevState.alwaysChargeSupported = false;
  await assert.rejects(invalid.setAlwaysCharge('on'), /not supported/);
  assert.deepEqual(events, ['post']);
});

function createStateDevice(previous, initialAlwaysCharge = null) {
  const capabilities = new Map([['evcc_always_charge', initialAlwaysCharge]]);
  const triggers = [];
  const device = Object.create(LoadpointDevice.prototype);
  device._prevState = previous;
  device.hasCapability = (capability) => capability === 'evcc_always_charge';
  device.getCapabilityValue = (capability) => capabilities.get(capability) ?? null;
  device.setCapabilityValue = async (capability, value) => capabilities.set(capability, value);
  device.error = () => {};
  device.homey = {
    flow: {
      getDeviceTriggerCard: (id) => ({
        trigger: (_device, tokens, state) => {
          triggers.push({ id, tokens, state });
          return Promise.resolve();
        },
      }),
    },
  };
  return { device, capabilities, triggers };
}

test('invalid Always charge clears stale capability state without false triggers', async () => {
  const previous = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'on' }, 1);
  const malformed = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'broken' }, 1);
  const { device, capabilities, triggers } = createStateDevice(previous, 'on');

  await device._applyState(malformed);

  assert.equal(malformed.alwaysCharge, null);
  assert.equal(malformed.alwaysChargeValid, false);
  assert.equal(malformed.legacyMode, null);
  assert.equal(capabilities.get('evcc_always_charge'), null);
  assert.deepEqual(triggers, []);
});

test('Always charge changes fire the legacy alias and Always trigger, not canonical Smart', async () => {
  const previous = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'on' }, 1);
  const current = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'off' }, 1);
  const { device, triggers } = createStateDevice(previous, 'on');

  await device._applyState(current);

  assert.deepEqual(triggers.map(({ id, tokens }) => [id, tokens]), [
    ['charge_mode_changed', { mode: 'pv' }],
    ['always_charge_changed', { state: 'off' }],
  ]);
});

test('initialization and a schema-only legacy-to-Smart migration emit no mode transition', async () => {
  const smart = normalizeLoadpoint({ mode: 'smart', alwaysCharge: 'off' }, 1);
  const initialized = createStateDevice({}, null);
  await initialized.device._applyState(smart);
  assert.deepEqual(initialized.triggers, []);

  const legacy = normalizeLoadpoint({ mode: 'pv' }, 1);
  const migrated = createStateDevice(legacy, null);
  await migrated.device._applyState(smart);
  assert.deepEqual(migrated.triggers, []);
});

test('adds and labels Always charge only on supported redesigned devices', async () => {
  const device = Object.create(LoadpointDevice.prototype);
  const capabilities = new Set();
  const options = [];
  const added = [];
  device._alwaysChargeListenerRegistered = false;
  device.hasCapability = (capability) => capabilities.has(capability);
  device.addCapability = async (capability) => { capabilities.add(capability); added.push(capability); };
  device.registerCapabilityListener = () => {};
  device.setCapabilityOptions = async (capability, value) => options.push({ capability, value });

  await device._syncSchemaCapabilities(normalizeLoadpoint({
    mode: 'smart', alwaysCharge: 'off', chargerFeatureContinuous: true,
  }, 1));
  await device._syncSchemaCapabilities(normalizeLoadpoint({
    mode: 'smart', alwaysCharge: 'on', chargerFeatureContinuous: true,
  }, 1));

  assert.deepEqual(added, ['evcc_always_charge']);
  assert.ok(options.some(({ capability, value }) => capability === 'evcc_always_charge'
    && value.title.en === 'Always heat'));

  const switchDevice = Object.create(LoadpointDevice.prototype);
  const switchOptions = [];
  switchDevice.hasCapability = () => false;
  switchDevice.addCapability = async () => assert.fail('must not add Always charge to switch device');
  switchDevice.setCapabilityOptions = async (capability, value) => switchOptions.push({ capability, value });
  await switchDevice._syncSchemaCapabilities(normalizeLoadpoint({
    mode: 'smart', alwaysCharge: 'off', chargerFeatureSwitchDevice: true,
  }, 1));
  assert.equal(switchOptions[0].value.values[2].title.en, 'On');
});
