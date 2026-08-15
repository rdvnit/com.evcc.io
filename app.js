'use strict';

const Homey = require('homey');

const CHARGE_MODES = ['off', 'pv', 'minpv', 'now'];
const BATTERY_MODES = ['unknown', 'normal', 'hold', 'charge'];

class EvccApp extends Homey.App {

  async onInit() {
    this._registerFlowCards();
    this.log('evcc app initialized');
  }

  _registerFlowCards() {
    const flow = this.homey.flow;

    flow.getActionCard('set_charge_mode')
      .registerRunListener(async (args) => args.device.setChargeMode(args.mode));

    flow.getActionCard('set_always_charge')
      .registerRunListener(async (args) => args.device.setAlwaysCharge(args.state));

    flow.getActionCard('set_target_soc')
      .registerRunListener(async (args) => args.device.setTargetSoc(args.soc));

    flow.getActionCard('set_min_current')
      .registerRunListener(async (args) => args.device.setMinCurrent(args.amps));

    flow.getActionCard('set_max_current')
      .registerRunListener(async (args) => args.device.setMaxCurrent(args.amps));

    flow.getActionCard('set_battery_mode')
      .registerRunListener(async (args) => args.device.setBatteryMode(args.mode));

    flow.getActionCard('set_battery_discharge_control')
      .registerRunListener(async (args) => args.device.setBatteryDischargeControl(args.enabled));

    flow.getActionCard('set_battery_buffer_soc')
      .registerRunListener(async (args) => args.device.setBatteryBufferSoc(args.soc));

    flow.getActionCard('set_battery_buffer_start_soc')
      .registerRunListener(async (args) => args.device.setBatteryBufferStartSoc(args.soc));

    flow.getActionCard('set_battery_priority_soc')
      .registerRunListener(async (args) => args.device.setBatteryPrioritySoc(args.soc));

    flow.getActionCard('set_grid_residual_power')
      .registerRunListener(async (args) => args.device.setGridResidualPower(args.power));

    flow.getActionCard('set_battery_grid_charge_limit')
      .registerRunListener(async (args) => args.device.setBatteryGridChargeLimit(args.cost));

    flow.getActionCard('reset_battery_control')
      .registerRunListener(async (args) => args.device.resetBatteryControl());

    flow.getConditionCard('charge_mode_is')
      .registerRunListener(async (args) => args.device.getCapabilityValue('evcc_charge_mode') === args.mode);

    flow.getConditionCard('always_charge_is')
      .registerRunListener(async (args) => args.device.getAlwaysCharge() === args.state);

    flow.getConditionCard('is_charging')
      .registerRunListener(async (args) => Boolean(args.device.getCapabilityValue('evcc_charging')));

    flow.getConditionCard('is_connected')
      .registerRunListener(async (args) => Boolean(args.device.getCapabilityValue('evcc_connected')));

    flow.getConditionCard('battery_mode_is')
      .registerRunListener(async (args) => args.device.getCapabilityValue('evcc_battery_mode') === args.mode);

    flow.getConditionCard('battery_discharge_allowed')
      .registerRunListener(async (args) => Boolean(args.device.getCapabilityValue('evcc_battery_discharge_control')));

    flow.getConditionCard('battery_is_charging')
      .registerRunListener(async (args) => (args.device.getCapabilityValue('measure_power') || 0) < 0);

    flow.getConditionCard('battery_is_discharging')
      .registerRunListener(async (args) => (args.device.getCapabilityValue('measure_power') || 0) > 0);
  }

}

module.exports = EvccApp;
module.exports.CHARGE_MODES = CHARGE_MODES;
module.exports.BATTERY_MODES = BATTERY_MODES;
