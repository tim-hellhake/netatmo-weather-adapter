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
        super(device, name, description);
        this.setCachedValue(value);
    }

    async setValue(value) {
        return Promise.reject("Read-only property");
    }
}

const UNITS = {
    Temperature: "celsius",
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

const STATION_TYPE = {
    NAMain: "Netatmo Weather Station",
    NAModule1: "Netatmo Outdoor module",
    NAModule2: "Netatmo Rain gauge",
    NAModule3: "Netatmo Wind gauge",
    NAModule4: "Netatmo Indoor module"
};

class WeatherStation extends Device {
    constructor(adapter, netatmoDevice) {
        super(adapter, netatmoDevice._id);
        this.name = netatmoDevice.module_name;
        this.description = STATION_TYPE[netatmoDevice.type];
        this.uiHref = "https://my.netatmo.com/app/station";

        for(const dataType of netatmoDevice.data_type) {
            this.properties.set(dataType, new NetatmoProperty(this, 'dataType', {
                type: "number",
                unit: UNITS[dataType]
            }, netatmoDevice.dashboard_data[dataType]));
        }

        if(netatmoDevice.battery_percent) {
            this.properties.set('battery', new NetatmoProperty(this, 'battery', {
                type: "number",
                unit: "percent"
            }, netatmoDevice.battery_percent));
        }

        this.adapter.handleDeviceAdded(this);
    }

    updateProp(propertyName, value) {
        const property = this.properties.get(propertyName);
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

    startPolling() {
        // Measurements seem to be taken about every 5 minutes, unless there is an on-demand measurement.
        this.iid = setInterval(() => this.adapter.updateDevice(this), 5 * 60 * 1000);
    }

    stopPolling() {
        clearInterval(this.iid);
    }
}

class NetatmoWeatherAdapter extends Adapter {
    constructor(addonManager, packageName, config) {
        super(addonManager, 'NetatmoWeatherAdapter', packageName);
        addonManager.addAdapter(this);

        this.netatmo = new Netatmo(config);

        this.startPairing();
    }

    addDevice(device) {
        if(device._id in this.devices) {
            return;
        }
        else {
            const instance = new WeatherStation(this, device);
            if(device.modules && device.modules.length) {
                for(const d of device.modules) {
                    this.addDevice(d);
                }
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
        this.netatmo.getStationsData({
            device_id: device.id
        }, (err, data) => {
            if(!err) {
                device.updateProperties(data[0]);
            }
            else {
                console.error(err);
            }
        });
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
    }

    unload() {
        for(const d in this.devices) {
            this.devices[d].stopPolling();
        }
        return super.unload();
    }
}

module.exports = (addonManager, manifest) => {
    const adapter = new NetatmoWeatherAdapter(addonManager, manifest.name, manifest.moziot.config)
};
