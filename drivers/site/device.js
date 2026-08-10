'use strict';

const Homey = require('homey');
const EvccApi = require('../../lib/EvccApi');
const { normalizeState } = require('../../lib/normalize');

class SiteDevice extends Homey.Device {

  async onInit() {
    const settings = this.getSettings();
    this._api = new EvccApi({ host: settings.host, password: settings.password });
    await this._poll();
    this._startPolling(settings.pollInterval || 10);
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

  async _safeSet(capability, value) {
    if (value === null || value === undefined) return;
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch((err) => this.error(`setCapabilityValue(${capability})`, err.message));
  }

  /** Adds/removes a capability to match whether evcc actually has that device configured. */
  async _syncCapability(capability, shouldHave) {
    const has = this.hasCapability(capability);
    if (shouldHave && !has) {
      await this.addCapability(capability).catch((err) => this.error(`addCapability(${capability})`, err.message));
    } else if (!shouldHave && has) {
      await this.removeCapability(capability).catch((err) => this.error(`removeCapability(${capability})`, err.message));
    }
  }

  async _poll() {
    try {
      const rawState = await this._api.getState();
      const { site, loadpoints } = normalizeState(rawState);

      await this._syncCapability('evcc_solar_power', true);
      await this._syncCapability('evcc_home_power', true);
      await this._syncCapability('evcc_grid_power', site.gridConfigured);
      await this._syncCapability('measure_power.pv', false);
      await this._syncCapability('measure_power.grid', false);
      await this._syncCapability('measure_power.home', false);
      await this._syncCapability('measure_power.battery', false);
      await this._syncCapability('measure_battery.home', false);

      await this._safeSet('evcc_solar_power', site.pvPower ?? 0);
      if (site.gridConfigured) await this._safeSet('evcc_grid_power', site.gridPower ?? 0);
      await this._safeSet('evcc_home_power', site.homePower ?? 0);

      if (!this.getAvailable()) await this.setAvailable();
      return { site, loadpoints };
    } catch (err) {
      this.error('evcc poll error:', err.message);
      await this.setUnavailable(err.message).catch(() => {});
    }
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

module.exports = SiteDevice;
