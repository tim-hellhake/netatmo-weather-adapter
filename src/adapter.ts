/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

"use strict";

import { Adapter, Device, Property } from 'gateway-addon';
import Netatmo from 'netatmo';

class NetatmoProperty extends Property {
    constructor(device: Device, name: string, description: any, value: any) {
        description.readOnly = true;
        super(device, name, description);
        this.setCachedValue(value);
    }

    async setValue(_value: any) {
        return Promise.reject("Read-only property");
    }
}

const UNITS: { [key: string]: string } = {
    Temperature: "degree celsius",
    Humidity: "percent",
    Pressure: "mbar",
    Noise: "dB",
    CO2: "ppm",
    Rain: "mm",
    WindStrength: "km/h",
    Guststrength: "km/h",
    WindAngle: "°",
    GustAngle: "°"
};

// Min and max are based on official sensor ranges and valid values for the unit.
// https://www.netatmo.com/en-us/weather/weatherstation/specifications
// https://www.netatmo.com/en-us/aircare/homecoach/specifications
const MIN: { [key: string]: number } = {
    Temperature: -40,
    Pressure: 260,
    Noise: 35,
    CO2: 0,
    Rain: 0,
    WindAngle: -360,
    GustAngle: -360
};

const MAX: { [key: string]: number } = {
    Temperature: 65,
    Pressure: 1260,
    Noise: 120,
    CO2: 5000,
    WindAngle: 360,
    GustAngle: 360
};

const CAPABILITES: { [key: string]: string } = {
    Temperature: "TemperatureProperty",
    Humidity: "HumidityProperty"
};

const DEVICE_CAPS: { [key: string]: string } = {
    Temperature: "TemperatureSensor",
    Humidity: "HumiditySensor"
};

const INTEGERS = [
    "Humidity",
    "Noise",
    "CO2"
];

const NICE_LABEL: { [key: string]: string } = {
    CO2: "CO₂",
    WindStrength: "Wind strength",
    Guststrength: "Gust strength",
    WindAngle: "Wind angle",
    GustAngle: "Gust angle",
    health_idx: "Health index"
};

const STATION_TYPE: { [key: string]: string } = {
    NAMain: "Netatmo Weather Station",
    NAModule1: "Netatmo Outdoor Module",
    NAModule2: "Netatmo Rain Gauge",
    NAModule3: "Netatmo Wind Gauge",
    NAModule4: "Netatmo Indoor Module",
    NHC: "Netatmo Health Coach"
};

const HEALTH_IDX_MAP = [
    'Healthy',
    'Fine',
    'Fair',
    'Poor',
    'Unhealthy'
];

class WeatherStation extends Device {
    private canUpdate: boolean;
    private pollingFor: Set<unknown>;
    private iid?: NodeJS.Timeout;

    constructor(adapter: Adapter, netatmoDevice: any, private parent: any) {
        super(adapter, netatmoDevice._id);
        this.name = netatmoDevice.module_name || netatmoDevice.station_name || netatmoDevice.name;
        this.description = STATION_TYPE[netatmoDevice.type] + ' for ' + (netatmoDevice.station_name || netatmoDevice.name);
        this.links = [
            {
                rel: 'alternate',
                mediaType: 'text/html',
                href: 'https://my.netatmo.com/app/station',
            }
        ];
        this.canUpdate = netatmoDevice.type == this.updatableType;
        this.parent = parent;
        this.pollingFor = new Set();
        this["@type"] = [];

        if(this.canUpdate && this.parent) {
            console.warn("Device can both update itself and has a parent.");
        }

        for(const dataType of netatmoDevice.data_type) {
            const props: any = {
                title: NICE_LABEL.hasOwnProperty(dataType) ? NICE_LABEL[dataType] : dataType,
                type: INTEGERS.includes(dataType) ? "integer" : "number"
            };
            if(UNITS.hasOwnProperty(dataType)) {
                props.unit = UNITS[dataType];
            }
            if(CAPABILITES.hasOwnProperty(dataType)) {
                props["@type"] = CAPABILITES[dataType];
            }
            if(DEVICE_CAPS.hasOwnProperty(dataType) && !this['@type'].includes(DEVICE_CAPS[dataType])) {
                this['@type'].push(DEVICE_CAPS[dataType]);
            }
            if(MIN.hasOwnProperty(dataType)) {
                props.minimum = MIN[dataType];
            }
            if(MAX.hasOwnProperty(dataType)) {
                props.maximum = MAX[dataType];
            }
            let value = netatmoDevice.dashboard_data.hasOwnProperty(dataType) ? netatmoDevice.dashboard_data[dataType] : NaN;
            if(dataType == 'health_idx') {
                props.type = 'string';
                props.enum = HEALTH_IDX_MAP;
                if(isNaN(value)) {
                    value = '';
                }
                else {
                    value = HEALTH_IDX_MAP[value];
                }
            }
            this.properties.set(dataType, new NetatmoProperty(this, dataType, props, value));
        }

        if(netatmoDevice.battery_percent) {
            this.properties.set('battery', new NetatmoProperty(this, 'battery', {
                title: "Battery",
                type: "number",
                unit: "percent",
                "@type": "LevelProperty"
            }, netatmoDevice.battery_percent));
        }

        if(netatmoDevice.wifi_status) {
            this.properties.set('signal', new NetatmoProperty(this, 'signal', {
                title: 'Signal strength',
                type: 'number',
                unit: 'percent',
                '@type': 'LevelProperty'
            }, WeatherStation.mapWifiToPercent(netatmoDevice.wifi_status)));
        }
        else if(netatmoDevice.rf_status) {
            this.properties.set('signal', new NetatmoProperty(this, 'signal', {
                title: 'Signal strength',
                type: 'number',
                unit: 'percent',
                '@type': 'LevelProperty'
            }, WeatherStation.mapRfToPercent(netatmoDevice.rf_status)));
        }

        if(netatmoDevice.hasOwnProperty('co2_calibrating')) {
            this.properties.set('calibrating', new NetatmoProperty(this, 'calibrating', {
                title: 'Calibrating CO₂',
                type: 'boolean'
            }, netatmoDevice.co2_calibrating));
        }

        this.adapter.handleDeviceAdded(this);
    }

    static clamp(num: number, max: number = 100, min: number = 0) {
        return Math.max(Math.min(num, max), min);
    }

    // Netatmo documents the expected good to bad ranges to be 30 units. However the strength
    // can be reported as better than good, thus the value needs to be clamped.
    static mapSignalToPercent(signal: number, min: number, range: number = 30) {
        return WeatherStation.clamp(((min - signal) / range) * 90 + 10);
    }

    static mapWifiToPercent(wifi: number) {
        return WeatherStation.mapSignalToPercent(wifi, 86);
    }

    static mapRfToPercent(rf: number) {
        return WeatherStation.mapSignalToPercent(rf, 90);
    }

    get updatableType() {
        return 'NAMain';
    }

    updateProp(propertyName: string, value: any) {
        const property = this.findProperty(propertyName);
        if(property.value != value) {
            property.setCachedValue(value);
            this.notifyPropertyChanged(property);
        }
    }

    updateProperties(netatmoDevice: any) {
        for(const dataType of netatmoDevice.data_type) {
            if(netatmoDevice.dashboard_data.hasOwnProperty(dataType)) {
                if(dataType === 'health_idx') {
                    this.updateProp(dataType, HEALTH_IDX_MAP[netatmoDevice.dashboard_data[dataType]]);
                }
                else {
                    this.updateProp(dataType, netatmoDevice.dashboard_data[dataType]);
                }
            }
        }

        if(netatmoDevice.battery_percent) {
            this.updateProp('battery', netatmoDevice.battery_percent);
        }

        if(netatmoDevice.wifi_status) {
            this.updateProp('signal', WeatherStation.mapWifiToPercent(netatmoDevice.wifi_status));
        }
        else if(netatmoDevice.rf_status) {
            this.updateProp('signal', WeatherStation.mapRfToPercent(netatmoDevice.rf_status));
        }

        if(netatmoDevice.hasOwnProperty('co2_calibrating')) {
            this.updateProp('calibrating', netatmoDevice.co2_calibrating);
        }
    }

    startPolling(id = this.id) {
        // Measurements seem to be taken about every 5 minutes, unless there is an on-demand measurement.
        if(this.canUpdate) {
            this.pollingFor.add(id);
            if(!this.iid) {
                this.iid = setInterval(() => this.adapter.updateDevice(this), 5 * 60 * 1000);
            }
        }
        else if(this.parent) {
            this.parent.startPolling(id);
        }
    }

    stopPolling(id = this.id) {
        if(this.canUpdate && this.iid) {
            this.pollingFor.delete(id);
            if(this.pollingFor.size == 0) {
                clearInterval(this.iid);
                this.iid = undefined;
                this.pollingFor.clear();
            }
        }
        else if(this.parent) {
            this.parent.stopPolling(id);
        }
    }
}

class HealthCoach extends WeatherStation {
    get updatableType() {
        return 'NHC';
    }
}

export class NetatmoWeatherAdapter extends Adapter {
    private netatmo?: Netatmo;

    constructor(addonManager: any, packageName: string, config: any, reportError: any) {
        super(addonManager, 'NetatmoWeatherAdapter', packageName);

        try {
            this.netatmo = new Netatmo(config);
        }
        catch(e) {
            console.warn(e);
            this.netatmo = undefined;
            reportError(packageName, "Netatmo API credentials are not valid. Please provide credentials in the add-on settings.");
            return;
        }

        addonManager.addAdapter(this);
        this.startPairing();
    }

    addDevice(device: any, parent?: any) {
        let instance;
        if(!(device._id in this.devices)) {
            if(device.type === 'NHC') {
                instance = new HealthCoach(this, device, parent);
            }
            else {
                instance = new WeatherStation(this, device, parent);
            }
        }
        else {
            instance = this.getDevice(device._id);
            instance.startPolling();
        }
        if(device.modules && device.modules.length) {
            for(const d of device.modules) {
                this.addDevice(d, instance);
            }
        }
    }

    handleDeviceAdded(device: WeatherStation | HealthCoach) {
        device.startPolling();
        super.handleDeviceAdded(device);
    }

    handleDeviceRemoved(device: WeatherStation | HealthCoach) {
        device.stopPolling();
        super.handleDeviceRemoved(device);
    }

    async updateDevice(device: WeatherStation | HealthCoach) {
        if(device instanceof HealthCoach) {
            this.netatmo?.getHealthyHomeCoachData({
                device_id: device.id
            }, (err, data) => {
                if(!err) {
                    const coach = data[0];
                    device.updateProperties(coach);
                }
                else {
                    console.error(err);
                }
            });
        }
        else {
            this.netatmo?.getStationsData({
                device_id: device.id
            }, (err, data) => {
                if(!err) {
                    const station = data[0];
                    device.updateProperties(station);
                    if(station.modules && station.modules.length) {
                        for(const module of station.modules) {
                            if(module._id in this.devices) {
                                this.getDevice(module._id).updateProperties(module);
                            }
                        }
                    }
                }
                else {
                    console.error(err);
                }
            });
        }
    }

    startPairing() {
        this.netatmo?.getStationsData((err: any, devices: any) => {
            if(!err) {
                for(const device of devices) {
                    this.addDevice(device);
                }
            }
            else {
                // this.sendPairingPrompt("Could not fetch station data. Ensure the provided credentials are valid.");
                console.error(err);
            }
        });
        this.netatmo?.getHealthyHomeCoachData((err: any, devices: any) => {
            if(!err) {
                for(const device of devices) {
                    this.addDevice(device);
                }
            }
            else {
                // this.sendPairingPrompt("Could not fetch healthy home coach data. Ensure the provided credentials are valid.");
                console.error(err);
            }
        });
    }

    unload() {
        for(const d in this.devices) {
            if(this.devices.hasOwnProperty(d)) {
                this.getDevice(d).stopPolling();
            }
        }
        return super.unload();
    }

    cancelRemoveThing(device: WeatherStation | HealthCoach) {
        device.startPolling();
    }
}
