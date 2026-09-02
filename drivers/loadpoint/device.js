'use strict';

const Homey = require('homey');
const EvccApi = require('../../lib/EvccApi');
const { normalizeState } = require('../../lib/normalize');

const LEGACY_MODE_VALUES = [
  { id: 'off', title: { en: 'Off' } },
  { id: 'pv', title: { en: 'Solar only' } },
  { id: 'minpv', title: { en: 'Min + Solar' } },
  { id: 'now', title: { en: 'Fast' } },
];
const SMART_MODE_VALUES = [
  { id: 'off', title: { en: 'Off' } },
  { id: 'smart', title: { en: 'Smart' } },
  { id: 'now', title: { en: 'Fast' } },
];
const SWITCH_MODE_VALUES = [
  { id: 'off', title: { en: 'Off' } },
  { id: 'smart', title: { en: 'Smart' } },
  { id: 'now', title: { en: 'On' } },
];
const HEATING_MODE_VALUES = [
  { id: 'off', title: { en: 'Normal' } },
  { id: 'smart', title: { en: 'Smart' } },
  { id: 'now', title: { en: 'Boost' } },
];

class LoadpointDevice extends Homey.Device {

  async onInit() {
    const settings = this.getSettings();
    const store = this.getStore();

    this._loadpointIndex = store.loadpointIndex;
    this._api = new EvccApi({ host: settings.host, password: settings.password });
    this._prevState = {};
    this._operationQueue = Promise.resolve();
    this._alwaysChargeListenerRegistered = false;

    this._registerCapabilityListeners();
    await this._poll();
    this._startPolling(settings.pollInterval || 10);
  }

  _registerCapabilityListeners() {
    this.registerCapabilityListener('evcc_charge_mode', async (value) => {
      await this.setChargeMode(value);
    });
    this.registerCapabilityListener('evcc_target_soc', async (value) => {
      // Homey's generic percent-slider stores/reports a 0-1 fraction; evcc's API and
      // our own setTargetSoc() work in whole percent (0-100).
      await this.setTargetSoc(Math.round(value * 100));
    });
    this._registerAlwaysChargeListener();
  }

  _registerAlwaysChargeListener() {
    if (this._alwaysChargeListenerRegistered || !this.hasCapability('evcc_always_charge')) return;
    this.registerCapabilityListener('evcc_always_charge', async (value) => {
      await this.setAlwaysCharge(value);
    });
    this._alwaysChargeListenerRegistered = true;
  }

  _startPolling(seconds) {
    this._clearPolling();
    this._pollInterval = this.homey.setInterval(() => {
      this._poll().catch((err) => this.error('Poll failed', err.message));
    }, Math.max(5, Number(seconds) || 10) * 1000);
  }

  _clearPolling() {
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  _enqueueOperation(operation) {
    const result = this._operationQueue.catch(() => {}).then(operation);
    this._operationQueue = result.catch(() => {});
    return result;
  }

  async _poll() {
    return this._enqueueOperation(() => this._pollOnce({ throwOnError: false }));
  }

  async _pollOnce({ throwOnError }) {
    try {
      const rawState = await this._api.getState();
      const { loadpoints } = normalizeState(rawState);
      const lp = loadpoints.find((l) => l.index === this._loadpointIndex);
      if (!lp) throw new Error(`Loadpoint ${this._loadpointIndex} not found on evcc instance`);

      await this._syncSchemaCapabilities(lp);
      await this._applyState(lp);

      if (!this.getAvailable()) await this.setAvailable();
      return lp;
    } catch (err) {
      this.error('evcc poll error:', err.message);
      await this.setUnavailable(err.message).catch(() => {});
      if (throwOnError) throw err;
      return null;
    }
  }

  async _safeSet(capability, value) {
    if (value === null || value === undefined) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch((err) => this.error(`setCapabilityValue(${capability})`, err.message));
  }

  async _clearIfSet(capability) {
    if (this.getCapabilityValue(capability) === null) return;
    await this.setCapabilityValue(capability, null).catch((err) => this.error(`setCapabilityValue(${capability})`, err.message));
  }

  async _syncSchemaCapabilities(lp) {
    const modeValues = lp.smartModeSchema
      ? lp.continuous ? HEATING_MODE_VALUES : lp.switchDevice ? SWITCH_MODE_VALUES : SMART_MODE_VALUES
      : LEGACY_MODE_VALUES;
    const modeSignature = JSON.stringify(modeValues);
    if (this._modeOptionsSignature !== modeSignature) {
      await this.setCapabilityOptions('evcc_charge_mode', { values: modeValues });
      this._modeOptionsSignature = modeSignature;
    }

    if (lp.smartModeSchema && lp.alwaysChargeSupported) {
      if (!this.hasCapability('evcc_always_charge')) {
        await this.addCapability('evcc_always_charge');
      }
      this._registerAlwaysChargeListener();

      const alwaysChargeTitle = lp.continuous ? 'Always heat' : 'Always charge';
      if (this._alwaysChargeTitle !== alwaysChargeTitle) {
        await this.setCapabilityOptions('evcc_always_charge', { title: { en: alwaysChargeTitle } });
        this._alwaysChargeTitle = alwaysChargeTitle;
      }
    }
  }

  async _applyState(lp) {
    const prev = this._prevState;

    await this._safeSet('evcc_charge_mode', lp.mode);
    if (lp.smartModeSchema && lp.alwaysChargeSupported && lp.alwaysChargeValid
      && this.hasCapability('evcc_always_charge')) {
      await this._safeSet('evcc_always_charge', lp.alwaysCharge);
    } else if (this.hasCapability('evcc_always_charge')) {
      await this._clearIfSet('evcc_always_charge');
    }
    await this._safeSet('evcc_target_soc', typeof lp.targetSoc === 'number' ? lp.targetSoc / 100 : null);
    // evcc only has live vehicle telemetry while a car is connected; when
    // disconnected it reports soc/range as 0 placeholders, not real values,
    // so show unknown ("-") instead of a stale or fake reading.
    if (lp.connected) {
      await this._safeSet('measure_battery', lp.vehicleSoc);
      await this._safeSet('evcc_vehicle_range', lp.vehicleRange);
    } else {
      await this._clearIfSet('measure_battery');
      await this._clearIfSet('evcc_vehicle_range');
    }
    await this._safeSet('measure_power', lp.chargePower ?? 0);
    await this._safeSet('meter_power', lp.chargedEnergy ?? 0);
    await this._safeSet('evcc_connected', lp.connected);
    await this._safeSet('evcc_charging', lp.charging);

    const flow = this.homey.flow;

    const sameModeSchema = prev.smartModeSchema !== undefined
      && prev.smartModeSchema === lp.smartModeSchema;
    if (sameModeSchema && prev.mode !== undefined && prev.mode !== lp.mode) {
      flow.getDeviceTriggerCard('charge_mode_changed')
        .trigger(this, { mode: lp.mode }, { mode: lp.mode })
        .catch((err) => this.error(err));
    }
    if (sameModeSchema && prev.legacyMode !== undefined && prev.legacyMode !== null
      && lp.legacyMode !== null && prev.legacyMode !== lp.legacyMode && lp.legacyMode !== lp.mode) {
      flow.getDeviceTriggerCard('charge_mode_changed')
        .trigger(this, { mode: lp.legacyMode }, { mode: lp.legacyMode })
        .catch((err) => this.error(err));
    }

    if (prev.alwaysCharge !== undefined && prev.alwaysCharge !== null
      && lp.alwaysCharge !== null && prev.alwaysCharge !== lp.alwaysCharge) {
      flow.getDeviceTriggerCard('always_charge_changed')
        .trigger(this, { state: lp.alwaysCharge }, { state: lp.alwaysCharge })
        .catch((err) => this.error(err));
    }

    if (prev.connected !== undefined && prev.connected !== lp.connected) {
      const cardId = lp.connected ? 'vehicle_connected' : 'vehicle_disconnected';
      flow.getDeviceTriggerCard(cardId).trigger(this).catch((err) => this.error(err));
    }

    if (prev.charging !== undefined && prev.charging !== lp.charging) {
      const cardId = lp.charging ? 'charging_started' : 'charging_stopped';
      flow.getDeviceTriggerCard(cardId).trigger(this).catch((err) => this.error(err));
    }

    if (lp.vehicleSoc !== null && lp.targetSoc !== null) {
      const reached = lp.vehicleSoc >= lp.targetSoc;
      const prevReached = prev.vehicleSoc !== undefined && prev.vehicleSoc !== null
        && prev.targetSoc !== undefined && prev.targetSoc !== null
        && prev.vehicleSoc >= prev.targetSoc;
      if (reached && !prevReached) {
        flow.getDeviceTriggerCard('target_soc_reached').trigger(this).catch((err) => this.error(err));
      }
    }

    this._prevState = lp;
  }

  async setChargeMode(mode) {
    return this._enqueueOperation(async () => {
      const redesigned = this._prevState && this._prevState.smartModeSchema === true;
      const legacy = this._prevState && this._prevState.smartModeSchema === false;
      const allowedModes = redesigned
        ? ['off', 'smart', 'now', 'pv', 'minpv']
        : legacy ? ['off', 'pv', 'minpv', 'now'] : [];
      if (!allowedModes.includes(mode)) {
        throw new Error('Unsupported charging mode for the detected evcc schema');
      }
      await this._api.setLoadpointMode(this._loadpointIndex, mode);
      return this._pollOnce({ throwOnError: true });
    });
  }

  isChargeMode(mode) {
    return Boolean(this._prevState)
      && (this._prevState.mode === mode || this._prevState.legacyMode === mode);
  }

  getAlwaysCharge() {
    return this._prevState.alwaysCharge;
  }

  async setAlwaysCharge(state) {
    return this._enqueueOperation(async () => {
      if (!['off', 'on', 'once'].includes(state)) throw new Error('Unsupported always charge state');
      if (!this._prevState || this._prevState.smartModeSchema !== true) {
        throw new Error('Always charge requires a valid redesigned evcc schema');
      }
      if (!this._prevState.alwaysChargeSupported) {
        throw new Error('Always charge is not supported by this charging point');
      }
      if (!this._prevState.alwaysChargeValid) {
        throw new Error('Always charge state from evcc is invalid');
      }
      await this._api.setLoadpointAlwaysCharge(this._loadpointIndex, state);
      return this._pollOnce({ throwOnError: true });
    });
  }

  /** soc is a whole percent (0-100); the capability itself stores a 0-1 fraction. */
  async setTargetSoc(soc) {
    const vehicleName = this._prevState && this._prevState.vehicleTitle;
    await this._api.setLoadpointLimitSoc(this._loadpointIndex, soc, vehicleName);
    await this._safeSet('evcc_target_soc', soc / 100);
  }

  async setMinCurrent(amps) {
    await this._api.setLoadpointMinCurrent(this._loadpointIndex, amps);
  }

  async setMaxCurrent(amps) {
    await this._api.setLoadpointMaxCurrent(this._loadpointIndex, amps);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('host')) this._api.setHost(newSettings.host);
    if (changedKeys.includes('password')) this._api.setPassword(newSettings.password);
    if (changedKeys.includes('pollInterval')) this._startPolling(newSettings.pollInterval);
    await this._poll();
  }

  async onDeleted() {
    this._clearPolling();
  }

}

module.exports = LoadpointDevice;
