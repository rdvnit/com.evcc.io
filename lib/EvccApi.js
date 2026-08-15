'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Minimal REST client for the evcc HTTP API (https://docs.evcc.io/docs/reference/api).
 * Uses Node core http/https only (no fetch/node-fetch) so it runs on every
 * Homey firmware/Node version without extra dependencies.
 *
 * evcc wraps most responses as { result: ... }; this client always resolves
 * with the unwrapped payload.
 */
class EvccApi {

  constructor({ host, password } = {}) {
    this.setHost(host);
    this.password = password || null;
    this.authCookie = null;
  }

  setHost(host) {
    if (!host) {
      this.baseUrl = null;
      return;
    }
    const normalized = /^https?:\/\//i.test(host) ? host : `http://${host}`;
    this.baseUrl = new URL(normalized.replace(/\/+$/, ''));
  }

  setPassword(password) {
    this.password = password || null;
    this.authCookie = null;
  }

  /** Low level request, returns unwrapped JSON body. */
  async _request(method, path, body, { retryAuth = true } = {}) {
    if (!this.baseUrl) throw new Error('No evcc host configured');

    const url = new URL(this.baseUrl.pathname.replace(/\/+$/, '') + '/api' + path, this.baseUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body !== undefined ? JSON.stringify(body) : null;

    const headers = { Accept: 'application/json' };
    if (payload) headers['Content-Type'] = 'application/json';
    if (this.authCookie) headers.Cookie = this.authCookie;

    const result = await new Promise((resolve, reject) => {
      const req = lib.request(url, { method, headers, timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, data }));
      });
      req.on('timeout', () => req.destroy(new Error('evcc request timed out')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

    // evcc issues a Set-Cookie on successful /auth/login
    const setCookie = result.headers['set-cookie'];
    if (setCookie && setCookie.length) {
      this.authCookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    }

    if (result.statusCode === 401 && this.password && retryAuth) {
      await this.login();
      return this._request(method, path, body, { retryAuth: false });
    }

    if (result.statusCode >= 400) {
      throw new Error(`evcc API ${method} ${path} failed: ${result.statusCode} ${result.data || ''}`.trim());
    }

    if (!result.data) return null;
    let json;
    try {
      json = JSON.parse(result.data);
    } catch (err) {
      throw new Error(`evcc API ${method} ${path} returned invalid JSON`);
    }
    return Object.prototype.hasOwnProperty.call(json, 'result') ? json.result : json;
  }

  async login() {
    if (!this.password) return;
    await this._request('POST', '/auth/login', { password: this.password }, { retryAuth: false });
  }

  /** GET /api/state - full site + loadpoint + vehicle snapshot. */
  async getState() {
    return this._request('GET', '/state');
  }

  /** GET /api/health - simple reachability check. */
  async getHealth() {
    return this._request('GET', '/health');
  }

  /** POST /api/loadpoints/{id}/mode/{mode} - off | smart | now plus legacy pv | minpv */
  async setLoadpointMode(loadpointId, mode) {
    return this._request('POST', `/loadpoints/${loadpointId}/mode/${mode}`);
  }

  /** POST /api/loadpoints/{id}/alwayscharge/{state} - off | on | once */
  async setLoadpointAlwaysCharge(loadpointId, state) {
    return this._request('POST', `/loadpoints/${loadpointId}/alwayscharge/${state}`);
  }

  /**
   * Set the vehicle charge limit (%) for a loadpoint. evcc moved this from a
   * loadpoint-level endpoint to a vehicle-level one across versions, so try
   * both and fall back gracefully.
   */
  async setLoadpointLimitSoc(loadpointId, soc, vehicleName) {
    try {
      return await this._request('POST', `/loadpoints/${loadpointId}/limitsoc/${soc}`);
    } catch (err) {
      if (vehicleName) {
        return this._request('POST', `/vehicles/${encodeURIComponent(vehicleName)}/limitsoc/${soc}`);
      }
      throw err;
    }
  }

  /** POST /api/loadpoints/{id}/mincurrent/{amps} */
  async setLoadpointMinCurrent(loadpointId, amps) {
    return this._request('POST', `/loadpoints/${loadpointId}/mincurrent/${amps}`);
  }

  /** POST /api/loadpoints/{id}/maxcurrent/{amps} */
  async setLoadpointMaxCurrent(loadpointId, amps) {
    return this._request('POST', `/loadpoints/${loadpointId}/maxcurrent/${amps}`);
  }

  /** POST /api/batterydischargecontrol/{enable} */
  async setBatteryDischargeControl(enable) {
    return this._request('POST', `/batterydischargecontrol/${enable ? 'true' : 'false'}`);
  }

  /** POST /api/batterymode/{batteryMode} - unknown | normal | hold | charge */
  async setBatteryMode(mode) {
    return this._request('POST', `/batterymode/${encodeURIComponent(mode)}`);
  }

  /** DELETE /api/batterymode - let evcc resume normal battery control. */
  async resetBatteryMode() {
    return this._request('DELETE', '/batterymode');
  }

  /** POST /api/buffersoc/{soc} */
  async setBatteryBufferSoc(soc) {
    return this._request('POST', `/buffersoc/${soc}`);
  }

  /** POST /api/bufferstartsoc/{soc} */
  async setBatteryBufferStartSoc(soc) {
    return this._request('POST', `/bufferstartsoc/${soc}`);
  }

  /** POST /api/prioritysoc/{soc} */
  async setBatteryPrioritySoc(soc) {
    return this._request('POST', `/prioritysoc/${soc}`);
  }

  /** POST /api/residualpower/{power} */
  async setGridResidualPower(power) {
    return this._request('POST', `/residualpower/${power}`);
  }

  /** POST /api/batterygridchargelimit/{cost} */
  async setBatteryGridChargeLimit(cost) {
    return this._request('POST', `/batterygridchargelimit/${cost}`);
  }
}

module.exports = EvccApi;
