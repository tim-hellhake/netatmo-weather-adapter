/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

import { Adapter, Device, Property } from 'gateway-addon';
import Netatmo, {
    NetatmoAPIDevice,
    NetatmoScope,
    NetatmoDeviceType,
    DataType,
    APIDashboardData,
    NetatmoStationDevice,
    NetatmoHealthyHomeCoachDevice,
    NetatmoStationRelatedDevice,
    WindModuleDashboardData
} from './netatmo';
import { addToConfig } from './config';
import { CallbackListener, CallbackAPIHandler } from './callback';

class NetatmoProperty extends Property {
    constructor(device: Device, name: string, description: any, value: any) {
        description.readOnly = true;
        super(device, name, description);
        this.setCachedValue(value);
    }

    async setValue(_value: any) {
        return Promise.reject('Read-only property');
    }
}

const UNITS: { [Property in keyof APIDashboardData]?: string } = {
    [DataType.Temperature]: 'degree celsius',
    [DataType.Humidity]: 'percent',
    [DataType.Pressure]: 'hectopascal',
    [DataType.Noise]: 'dB',
    [DataType.CO2]: 'ppm',
    [DataType.Rain]: 'mm',
    WindStrength: 'km/h',
    GustStrength: 'km/h',
    WindAngle: '°',
    GustAngle: '°'
};

// Min and max are based on official sensor ranges and valid values for the unit.
// https://www.netatmo.com/en-us/weather/weatherstation/specifications
// https://www.netatmo.com/en-us/aircare/homecoach/specifications
const MIN: { [Property in keyof APIDashboardData]?: number } = {
    [DataType.Temperature]: -40,
    [DataType.Pressure]: 260,
    [DataType.Noise]: 35,
    [DataType.CO2]: 0,
    [DataType.Rain]: 0,
    WindAngle: -360,
    GustAngle: -360
};

const MAX: { [Property in keyof APIDashboardData]?: number } = {
    [DataType.Temperature]: 65,
    [DataType.Pressure]: 1260,
    [DataType.Noise]: 120,
    [DataType.CO2]: 5000,
    WindAngle: 360,
    GustAngle: 360
};

const CAPABILITES: { [Property in keyof APIDashboardData]?: string } = {
    Temperature: 'TemperatureProperty',
    Humidity: 'HumidityProperty',
    Pressure: 'BarometricPressureProperty',
    CO2: 'ConcentrationProperty'
};

const DEVICE_CAPS: { [Property in keyof APIDashboardData]?: string } = {
    Temperature: 'TemperatureSensor',
    Humidity: 'HumiditySensor',
    Pressure: 'BarometricPressureSensor',
    CO2: 'AirQualitySensor'
};

const INTEGERS: (keyof APIDashboardData)[] = [
    DataType.Humidity,
    DataType.Noise,
    DataType.CO2
];

const NICE_LABEL: { [Property in keyof APIDashboardData]?: string } = {
    [DataType.CO2]: 'CO₂',
    WindStrength: 'Wind strength',
    GustStrength: 'Gust strength',
    WindAngle: 'Wind angle',
    GustAngle: 'Gust angle',
    [DataType.HealthIndex]: 'Health index'
};

const STATION_TYPE: Record<NetatmoDeviceType, string> = {
    [NetatmoDeviceType.Station]: 'Netatmo Weather Station',
    [NetatmoDeviceType.Outdoor]: 'Netatmo Outdoor Module',
    [NetatmoDeviceType.Wind]: 'Netatmo Wind Gauge',
    [NetatmoDeviceType.Rain]: 'Netatmo Rain Gauge',
    [NetatmoDeviceType.Indoor]: 'Netatmo Indoor Module',
    [NetatmoDeviceType.Coach]: 'Netatmo Health Coach'
};

const HEALTH_IDX_MAP = [
    'Healthy',
    'Fine',
    'Fair',
    'Poor',
    'Unhealthy'
];

class WeatherStation<T extends NetatmoAPIDevice> extends Device {
    private canUpdate: boolean;
    private pollingFor: Set<unknown>;
    private iid?: NodeJS.Timeout;

    // Sadly we can't use the generic for the return type, that would've been too good
    // (plus typescript gets way confused with these union keyofs)
    static getAvailableProperties<T extends NetatmoAPIDevice>(dataType: T["data_type"]): (keyof APIDashboardData)[] {
        if(dataType.length === 1 && dataType[0] === DataType.Wind) {
            return [ 'WindStrength', 'WindAngle', 'GustStrength', 'GustAngle' ] as (keyof WindModuleDashboardData)[];
        }
        return dataType as (keyof APIDashboardData)[];
    }

    constructor(adapter: Adapter, netatmoDevice: T, private parent?: WeatherStation<NetatmoStationDevice>) {
        super(adapter, netatmoDevice._id);
        this.name = netatmoDevice.module_name;
        let stationName;
        const isCoach = netatmoDevice.type === NetatmoDeviceType.Coach;
        const isStation = netatmoDevice.type === NetatmoDeviceType.Station;
        const isStationOrCoach = isStation || isCoach;
        const isModule = !isStationOrCoach;
        if(isModule && !parent) {
            throw new Error("Module without parent station");
        }
        if(!stationName && isStationOrCoach) {
            stationName = netatmoDevice.home_name;
        }
        if(!stationName && isCoach) {
            stationName = netatmoDevice.name;
        }
        if(!stationName && isModule && parent) {
            stationName = parent.name;
        }
        this.description = STATION_TYPE[netatmoDevice.type] + ' for ' + stationName;
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
        this['@type'] = [];

        if(this.canUpdate && this.parent) {
            console.warn('Device can both update itself and has a parent.');
        }

        const availableProperties = WeatherStation.getAvailableProperties<T>(netatmoDevice.data_type);
        for(const dataType of availableProperties) {
            if (typeof dataType !== "string") {
                continue;
            }
            const props: any = {
                title: NICE_LABEL.hasOwnProperty(dataType) ? NICE_LABEL[dataType] : dataType,
                type: INTEGERS.includes(dataType) ? 'integer' : 'number'
            };
            if(UNITS.hasOwnProperty(dataType)) {
                props.unit = UNITS[dataType];
            }
            if(CAPABILITES.hasOwnProperty(dataType)) {
                props['@type'] = CAPABILITES[dataType];
            }
            if(typeof DEVICE_CAPS[dataType] === "string" && !this['@type'].includes(DEVICE_CAPS[dataType] as string)) {
                this['@type'].push(DEVICE_CAPS[dataType] as string);
            }
            if(MIN.hasOwnProperty(dataType)) {
                props.minimum = MIN[dataType];
            }
            if(MAX.hasOwnProperty(dataType)) {
                props.maximum = MAX[dataType];
            }
            let value: string | number = netatmoDevice?.dashboard_data?.hasOwnProperty(dataType) ? (netatmoDevice.dashboard_data as APIDashboardData)[dataType] : NaN;
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

        if(isModule && netatmoDevice.battery_percent) {
            this.properties.set('battery', new NetatmoProperty(this, 'battery', {
                title: 'Battery',
                type: 'number',
                unit: 'percent',
                '@type': 'LevelProperty'
            }, netatmoDevice.battery_percent));
        }

        if(isStationOrCoach && netatmoDevice.wifi_status) {
            this.properties.set('signal', new NetatmoProperty(this, 'signal', {
                title: 'Signal strength',
                type: 'number',
                unit: 'percent',
                '@type': 'LevelProperty'
            }, WeatherStation.mapWifiToPercent(netatmoDevice.wifi_status)));
        }
        else if(isModule && netatmoDevice.rf_status) {
            this.properties.set('signal', new NetatmoProperty(this, 'signal', {
                title: 'Signal strength',
                type: 'number',
                unit: 'percent',
                '@type': 'LevelProperty'
            }, WeatherStation.mapRfToPercent(netatmoDevice.rf_status)));
        }

        if(isStationOrCoach && netatmoDevice.hasOwnProperty('co2_calibrating')) {
            this.properties.set('calibrating', new NetatmoProperty(this, 'calibrating', {
                title: 'Calibrating CO₂',
                type: 'boolean'
            }, netatmoDevice.co2_calibrating));
        }

        this.adapter.handleDeviceAdded(this);

        if(!netatmoDevice.reachable) {
            this.connectedNotify(false);
        }
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
        return NetatmoDeviceType.Station;
    }

    updateProp(propertyName: string, value: any) {
        const property = this.findProperty(propertyName);
        if(property.value != value) {
            property.setCachedValue(value);
            this.notifyPropertyChanged(property);
        }
    }

    updateProperties(netatmoDevice: T) {
        this.connectedNotify(netatmoDevice.reachable);
        if (!netatmoDevice.reachable) {
            return;
        }
        const isCoach = netatmoDevice.type === NetatmoDeviceType.Coach;
        const availableProperties = WeatherStation.getAvailableProperties<T>(netatmoDevice.data_type);
        for(const dataType of availableProperties) {
            if(typeof dataType === "string" && netatmoDevice.dashboard_data.hasOwnProperty(dataType)) {
                if(dataType === DataType.HealthIndex && isCoach) {
                    this.updateProp(dataType, HEALTH_IDX_MAP[netatmoDevice.dashboard_data[dataType]]);
                }
                else {
                    this.updateProp(dataType, (netatmoDevice.dashboard_data as APIDashboardData)[dataType]);
                }
            }
        }

        const isStationOrCoach = netatmoDevice.type === NetatmoDeviceType.Station || isCoach;
        const isModule = !isStationOrCoach;

        if(isModule && netatmoDevice.battery_percent) {
            this.updateProp('battery', netatmoDevice.battery_percent);
        }

        if(isStationOrCoach && netatmoDevice.wifi_status) {
            this.updateProp('signal', WeatherStation.mapWifiToPercent(netatmoDevice.wifi_status));
        }
        else if( isModule && netatmoDevice.rf_status) {
            this.updateProp('signal', WeatherStation.mapRfToPercent(netatmoDevice.rf_status));
        }

        if(isStationOrCoach && netatmoDevice.hasOwnProperty('co2_calibrating')) {
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

class HealthCoach extends WeatherStation<NetatmoHealthyHomeCoachDevice> {
    get updatableType() {
        return NetatmoDeviceType.Coach;
    }
}

export class NetatmoWeatherAdapter extends Adapter {
    private netatmo?: Netatmo;
    private apiHandler: CallbackAPIHandler;

    constructor(addonManager: any, private packageName: string, private config: any, private reportError: (name: string, errorMessage: string, url?: string) => void) {
        super(addonManager, 'NetatmoWeatherAdapter', packageName);
        this.apiHandler = new CallbackAPIHandler(addonManager, packageName);

        try {
            this.netatmo = new Netatmo(config, (config) => addToConfig(packageName, config));
            if(this.netatmo.needsAuth) {
                this.authenticate();
            }
        }
        catch(e) {
            console.warn(e);
            this.reportError(packageName, 'Netatmo API credentials are not valid. Please provide credentials in the add-on settings.');
            return;
        }

        addonManager.addAdapter(this);
    }

    async authenticate() {
        if(!this.netatmo) {
            return;
        }
        const redirectURI = `${this.config.baseUrl}/extensions/${this.packageName}`;
        const iterable = this.netatmo.authenticate([NetatmoScope.read_homecoach, NetatmoScope.read_station], redirectURI);
        const { value: url } = await iterable.next();
        if(url) {
            const listener = new CallbackListener('callback-listener');
            this.apiHandler.addListener(listener);
            this.sendPairingPrompt('Please authorize the adapter to access your Netatmo account.', url);
            const result = await listener.successPromise;
            if (typeof result !== "string") {
                console.error("Got unknown response from callback handler");
                return;
            }
            await iterable.next(result);
            this.addDevices();
        }
    }

    addDevice(device: NetatmoAPIDevice, parent?: WeatherStation<NetatmoStationDevice>) {
        let instance = this.getOrCreateDevice(device, parent);

        if(!parent && device.type === NetatmoDeviceType.Station && device.modules && device.modules.length) {
            for(const d of device.modules) {
                this.addDevice(d, instance);
            }
        }
    }

    private getOrCreateDevice(device: NetatmoAPIDevice, parent?: WeatherStation<NetatmoStationDevice>) {
        if(device._id in this.devices) {
            let instance = this.getDevice(device._id);
            instance.startPolling();
            return instance;
        }

        if(device.type === NetatmoDeviceType.Coach) {
            return new HealthCoach(this, device, parent);
        }

        return new WeatherStation(this, device, parent);
    }

    handleDeviceAdded(device: WeatherStation<NetatmoStationRelatedDevice> | HealthCoach) {
        device.startPolling();
        super.handleDeviceAdded(device);
    }

    handleDeviceRemoved(device: WeatherStation<NetatmoStationRelatedDevice> | HealthCoach) {
        device.stopPolling();
        super.handleDeviceRemoved(device);
    }

    async updateDevice(device: WeatherStation<NetatmoStationRelatedDevice> | HealthCoach) {
        if(device instanceof HealthCoach) {
            this.netatmo?.getHealthyHomeCoachData(device.id).then((data) => {
                const coach = data[0];
                device.updateProperties(coach);
            }, (err) => console.error(err));
        }
        else {
            this.netatmo?.getStationsData(device.id).then((data) => {
                const station = data[0];
                device.updateProperties(station);
                if(station.modules && station.modules.length) {
                    for(const module of station.modules) {
                        if(module._id in this.devices) {
                            this.getDevice(module._id).updateProperties(module);
                        }
                    }
                }
            }, (err) => console.error(err));
        }
    }

    addDevices() {
        this.netatmo?.getStationsData().then((devices) => {
            for(const device of devices) {
                this.addDevice(device);
            }
        }, (err) => {
            // this.sendPairingPrompt('Could not fetch station data. Ensure the provided credentials are valid.');
            console.error(err);
        });
        this.netatmo?.getHealthyHomeCoachData().then((devices) => {
            for(const device of devices) {
                this.addDevice(device);
            }
        }, (err) => {
            // this.sendPairingPrompt('Could not fetch healthy home coach data. Ensure the provided credentials are valid.');
            console.error(err);
        });
    }

    async startPairing() {
        if (this.netatmo?.needsAuth) {
            await this.authenticate();
        }
        this.addDevices();
    }

    unload() {
        for(const d in this.devices) {
            if(this.devices.hasOwnProperty(d)) {
                this.getDevice(d).stopPolling();
            }
        }
        if(this.netatmo) {
            this.netatmo.unInit();
        }
        return super.unload();
    }

    cancelRemoveThing(device: WeatherStation<NetatmoStationRelatedDevice> | HealthCoach) {
        device.startPolling();
    }
}
