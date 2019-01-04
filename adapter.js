"use strict";

const Netatmo = require("netatmo");

let Adapter, Device, Property;
try {
    Adapter = require('../adapter');
    Device = require('../device');
    Property = require('../property');
}
catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
        throw e;
    }

    const gwa = require('gateway-addon');
    Adapter = gwa.Adapter;
    Device = gwa.Device;
    Property = gwa.Property;
}

class NetatmoProperty extends Property {
    constructor(device, name, description, value) {
        description.readOnly = true;
        super(device, name, description);
        this.setCachedValue(value);
    }

    async setValue(value) {
        return Promise.reject("Read-only property");
    }
}

const UNITS = {
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

const MIN = {
    Temperature: -273.15,
    Rain: 0,
    CO2: 0,
    WindAngle: -360,
    GustAngle: -360
};

const MAX = {
    WindAngle: 360,
    GustAngle: 360
};

const CAPABILITES = {
    Temperature: "TemperatureProperty"
};

const DEVICE_CAPS = {
    Temperature: "TemperatureSensor"
};

const STATION_TYPE = {
    NAMain: "Netatmo Weather Station",
    NAModule1: "Netatmo Outdoor Module",
    NAModule2: "Netatmo Rain Gauge",
    NAModule3: "Netatmo Wind Gauge",
    NAModule4: "Netatmo Indoor Module",
    NHC: "Netatmo Health Coach"
};

class WeatherStation extends Device {
    constructor(adapter, netatmoDevice, parent) {
        super(adapter, netatmoDevice._id);
        this.name = netatmoDevice.module_name;
        this.description = STATION_TYPE[netatmoDevice.type];
        this.uiHref = "https://my.netatmo.com/app/station";
        this.canUpdate = netatmoDevice.type == this.updatableType;
        this.parent = parent;
        this.pollingFor = new Set();
        this["@type"] = [];

        if(this.canUpdate && this.parent) {
            console.warn("Device can both update itself and has a parent.");
        }

        for(const dataType of netatmoDevice.data_type) {
            const props = {
                label: dataType,
                type: "number",
                unit: UNITS[dataType]
            };
            if(CAPABILITES.hasOwnProperty(dataType)) {
                props["@type"] = CAPABILITES[dataType];
            }
            if(DEVICE_CAPS.hasOwnProperty(dataType) && !this['@type'].includes(DEVICE_CAPS[dataType])) {
                this['@type'].push(DEVICE_CAPS[dataType]);
            }
            if(MIN.hasOwnProperty(dataType)) {
                props['minimum'] = MIN[dataType];
            }
            if(MAX.hasOwnProperty(dataType)) {
                props['maximum'] = MAX[dataType];
            }
            this.properties.set(dataType, new NetatmoProperty(this, dataType, props, netatmoDevice.dashboard_data[dataType]));
        }

        if(netatmoDevice.battery_percent) {
            this.properties.set('battery', new NetatmoProperty(this, 'battery', {
                label: "Battery",
                type: "number",
                unit: "percent",
                "@type": "LevelProperty"
            }, netatmoDevice.battery_percent));
        }

        this.adapter.handleDeviceAdded(this);
    }

    get updatableType() {
        return 'NAMain';
    }

    updateProp(propertyName, value) {
        const property = this.findProperty(propertyName);
        if(property.value != value) {
            property.setCachedValue(value);
            this.notifyPropertyChanged(property);
        }
    }

    updateProperties(netatmoDevice) {
        for(const dataType of netatmoDevice.data_type) {
            this.updateProp(dataType, netatmoDevice.dashboard_data[dataType]);
        }

        if(netatmoDevice.battery_percent) {
            this.updateProp('battery', netatmoDevice.battery_percent);
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

class NetatmoWeatherAdapter extends Adapter {
    constructor(addonManager, packageName, config) {
        super(addonManager, 'NetatmoWeatherAdapter', packageName);
        addonManager.addAdapter(this);

        this.netatmo = new Netatmo(config);

        this.startPairing();
    }

    addDevice(device, parent) {
        let instance;
        if(!(device._id in this.devices)) {
            if(device.type === 'NHC') {
                insance = new HealthCoach(this, device, parent);
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

    handleDeviceAdded(device) {
        device.startPolling();
        super.handleDeviceAdded(device);
    }

    handleDeviceRemoved(device) {
        device.stopPolling();
        super.handleDeviceRemoved(device);
    }

    async updateDevice(device) {
        if(device instanceof HealthCoach) {
            this.netatmo.getHealthyHomeCoachData({
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
            this.netatmo.getStationsData({
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
        this.netatmo.getStationsData((err, devices) => {
            if(!err) {
                for(const device of devices) {
                    this.addDevice(device);
                }
            }
            else {
                console.error(err);
            }
        });
        this.netatmo.getHealthyHomeCoachData((err, devices) => {
            if(!err) {
                for(const device of devices) {
                    this.addDevice(device);
                }
            }
            else {
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

    removeThing(device) {
        device.stopPolling();
    }

    cancelRemoveThing(device) {
        device.startPolling();
    }
}

module.exports = (addonManager, manifest) => {
    const adapter = new NetatmoWeatherAdapter(addonManager, manifest.name, manifest.moziot.config)
};
