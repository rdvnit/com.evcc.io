'use strict';

const Homey = require('homey');
const EvccApi = require('../../lib/EvccApi');
const { normalizeState } = require('../../lib/normalize');
const slug = require('../../lib/slug');

class SiteDriver extends Homey.Driver {

  async onInit() {
    this.log('Site driver initialized');
  }

  async onPair(session) {
    let host;
    let password;

    session.setHandler('get-prefill', async () => {
      const lastHost = this.homey.settings.get('lastHost');
      if (lastHost) session.emit('prefill', { host: lastHost });
      return true;
    });

    session.setHandler('connect', async (data) => {
      host = (data && data.host || '').trim();
      password = (data && data.password) || '';

      if (!host) throw new Error('Please enter the evcc URL.');

      const api = new EvccApi({ host, password });
      if (password) await api.login();
      await api.getState();

      this.homey.settings.set('lastHost', host);
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!host) throw new Error('Enter the evcc URL and press Connect first.');
      const api = new EvccApi({ host, password });
      if (password) await api.login();
      const rawState = await api.getState();
      const { site } = normalizeState(rawState);

      const capabilities = ['evcc_solar_power', 'evcc_home_power'];
      if (site.gridConfigured) capabilities.push('evcc_grid_power');

      const hostSlug = slug(host);
      return [{
        name: site.siteTitle || 'evcc',
        data: { id: `${hostSlug}-site` },
        store: { host, password },
        capabilities,
        settings: {
          host,
          password: password || '',
          pollInterval: 10,
        },
      }];
    });
  }

}

module.exports = SiteDriver;
