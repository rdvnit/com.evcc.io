'use strict';

const Homey = require('homey');
const EvccApi = require('../../lib/EvccApi');
const { normalizeState } = require('../../lib/normalize');

class LoadpointDevice extends Homey.Device {

  async onInit() {
    const settings = this.getSettings();
    const store = this.getStore();

    this._loadpointIndex = store.loadpointIndex;
    this._api = new EvccApi({ host: settings.host, password: settings.password });
    this._prevState = {};

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

  async _poll() {
    try {
      const rawState = await this._api.getState();
      const { loadpoints } = normalizeState(rawState);
      const lp = loadpoints.find((l) => l.index === this._loadpointIndex);
      if (!lp) throw new Error(`Loadpoint ${this._loadpointIndex} not found on evcc instance`);

      await this._applyState(lp);

      if (!this.getAvailable()) await this.setAvailable();
      return lp;
    } catch (err) {
      this.error('evcc poll error:', err.message);
      await this.setUnavailable(err.message).catch(() => {});
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

  async _applyState(lp) {
    const prev = this._prevState;

    await this._safeSet('evcc_charge_mode', this._homeyChargeMode(lp));
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

    const previousHomeyMode = this._homeyChargeMode(prev);
    const homeyMode = this._homeyChargeMode(lp);
    if (previousHomeyMode !== undefined && previousHomeyMode !== homeyMode) {
      flow.getDeviceTriggerCard('charge_mode_changed')
        .trigger(this, { mode: homeyMode }, { mode: homeyMode })
        .catch((err) => this.error(err));
    }

    if (prev.alwaysCharge !== undefined && prev.alwaysCharge !== lp.alwaysCharge) {
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
    await this._api.setLoadpointMode(this._loadpointIndex, mode);
    await this._poll();
  }

  _homeyChargeMode(lp) {
    return lp && (lp.homeyMode || lp.mode);
  }

  getAlwaysCharge() {
    return this._prevState.alwaysCharge;
  }

  async setAlwaysCharge(state) {
    if (!['off', 'on', 'once'].includes(state)) throw new Error('Unsupported always charge state');
    if (!this._prevState.smartModeSchema) throw new Error('Always charge requires a newer evcc version');
    if (!this._prevState.alwaysChargeSupported) throw new Error('Always charge is not supported by this charging point');
    await this._api.setLoadpointAlwaysCharge(this._loadpointIndex, state);
    await this._poll();
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
