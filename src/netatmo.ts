/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

import fetch from 'node-fetch';

export enum NetatmoScope {
    'read_station',
    'read_homecoach',
}

interface NetatmoConfig {
    client_id: string;
    client_secret: string;
    expires?: number;
    refresh_token?: string;
}

interface AuthenticatedNetatmoConfig extends NetatmoConfig {
    token?: string;
}

interface NetatmoTokenResponse {
    expires_in: number;
    access_token: string;
    refresh_token: string;
}

export enum NetatmoDeviceType {
    Station = 'NAMain',
    Outdoor = 'NAModule1',
    Wind = 'NAModule2',
    Rain = 'NAModule3',
    Indoor = 'NAModule4',
    Coach = 'NHC'
}

enum Trend {
    'up',
    'down'
}

interface DashboardData {
    time_utc: number;
}

export enum DataType {
    Temperature = 'Temperature',
    Humidity = 'Humidity',
    CO2 = 'CO2',
    Pressure = 'Pressure',
    Noise = 'Noise',
    Wind = 'Wind',
    Rain = 'Rain',
    HealthIndex = 'health_idx'
}

interface TemperatureDashboardData extends DashboardData {
    [DataType.Temperature]: number;
    min_temp: number;
    max_temp: number;
    date_min_temp: number;
    date_max_temp: number;
    temp_trend: Trend;
}

interface NetatmoDevice {
    _id: string;
    reachable: boolean;
    type: NetatmoDeviceType;
    data_type: DataType[];
    dashboard_data: DashboardData;
    module_name: string;
    firmware: number;
    last_setup: number;
}

interface NetatmoModuleDevice extends NetatmoDevice {
    last_seen: number;
    last_message: number;
    rf_status: number;
    battery_vp: number;
    battery_percent: number;
}

interface IndoorModuleDashboardData extends TemperatureDashboardData {
    [DataType.CO2]: number;
    [DataType.Humidity]: number;
}

interface NetatmoIndoorModuleDevice extends NetatmoModuleDevice {
    type: NetatmoDeviceType.Indoor;
    data_type: [ DataType.Temperature, DataType.Humidity, DataType.CO2 ];
    dashboard_data: IndoorModuleDashboardData;
}

interface OutdoorModuleDashboardData extends TemperatureDashboardData {
    [DataType.Humidity]: number;
}

interface NetatmoOudoorModuleDevice extends NetatmoModuleDevice {
    type: NetatmoDeviceType.Outdoor;
    data_type: [ DataType.Temperature, DataType.Humidity ];
    dashboard_data: OutdoorModuleDashboardData;
}

interface RainModuleDashboardData extends DashboardData {
    [DataType.Rain]: number;
    sum_rain_24: number;
    sum_rain_1: number;
}

interface NetatmoRainModuleDevice extends NetatmoModuleDevice {
    type: NetatmoDeviceType.Rain;
    data_type: [ DataType.Rain ];
    dashboard_data: RainModuleDashboardData;
}

export interface WindModuleDashboardData extends DashboardData {
    WindStrength: number;
    WindAngle: number;
    GustStrength: number;
    GustAngle: number;
    max_wind_str: number;
    max_wind_angle: number;
    date_max_wind_str: number;
}

interface NetatmoWindModuleDevice extends NetatmoModuleDevice {
    type: NetatmoDeviceType.Wind;
    data_type: [ DataType.Wind ];
    dashboard_data: WindModuleDashboardData;
}

type StationModule = NetatmoIndoorModuleDevice | NetatmoOudoorModuleDevice | NetatmoRainModuleDevice | NetatmoWindModuleDevice;

interface StationDashboardData extends TemperatureDashboardData {
    [DataType.CO2]: number;
    [DataType.Humidity]: number;
    [DataType.Noise]: number;
    [DataType.Pressure]: number;
    AbsolutePressure: number;
    pressure_trend: Trend;
}

export interface NetatmoStationDevice extends NetatmoDevice {
    type: NetatmoDeviceType.Station;
    modules: StationModule[];
    data_type: [ DataType.Temperature, DataType.Humidity, DataType.Noise, DataType.CO2, DataType.Pressure ];
    dashboard_data: StationDashboardData;
    wifi_status: number;
    co2_calibrating: boolean;
    station_name: string;
    home_id: string;
    home_name: string;
    last_upgrade: number;
    date_setup: number;
    last_status_store: number;
    place: {
        timezone: string,
        country: string,
        altitude: number,
        location: [number, number]
    };
}

enum HealthIndex {
    Healthy = 0,
    Fine = 1,
    Fair = 2,
    Poor = 3,
    Unhealthy = 4
}

interface HealthyHomeCoachDashboardData extends TemperatureDashboardData {
    [DataType.CO2]: number;
    [DataType.Humidity]: number;
    [DataType.Noise]: number;
    [DataType.Pressure]: number;
    AbsolutePressure: number;
    [DataType.HealthIndex]: HealthIndex;
}

export interface NetatmoHealthyHomeCoachDevice extends NetatmoDevice {
    type: NetatmoDeviceType.Coach;
    wifi_status: number;
    co2_calibrating: boolean;
    station_name: string;
    home_id: string;
    home_name: string;
    last_upgrade: number;
    date_setup: number;
    last_status_store: number;
    place: {
        timezone: string,
        country: string,
        altitude: number,
        location: [number, number]
    };
    data_type: [ DataType.Temperature, DataType.CO2, DataType.Humidity, DataType.Pressure, DataType.HealthIndex, DataType.Noise ];
    dashboard_data: HealthyHomeCoachDashboardData;
    name: string;
}

export type NetatmoStationRelatedDevice = NetatmoStationDevice | StationModule;
export type NetatmoAPIDevice = NetatmoStationDevice | NetatmoHealthyHomeCoachDevice | StationModule;
export type APIDashboardData = StationDashboardData & HealthyHomeCoachDashboardData & OutdoorModuleDashboardData & WindModuleDashboardData & RainModuleDashboardData & IndoorModuleDashboardData;

export default class Netatmo {
    private refreshInterval?: NodeJS.Timeout;
    private config: AuthenticatedNetatmoConfig;

    constructor(config: NetatmoConfig, private setConfig: (config: Record<string, any>) => Promise<void>) {
        this.config = config;
        if(config.refresh_token) {
            this.initRefresh();
        }
    }

    private initRefresh() {
        const expiresIn = Date.now() - (this.config.expires ?? 0);
        if (expiresIn > 0 && this.config.token) {
            this.refreshInterval = setTimeout(() => this.refresh(), expiresIn);
        }
        else {
            this.refresh();
        }
    }

    private async refresh() {
        delete this.refreshInterval;
        this.config.token = '';
        if(!this.config.refresh_token) {
            console.error('Can not refresh token.');
            return;
        }
        const body = new URLSearchParams();
        body.append('grant_type', 'refresh_token');
        body.append('refresh_token', this.config.refresh_token);
        body.append('client_id', this.config.client_id);
        body.append('client_secret', this.config.client_secret);
        const response = await fetch('https://api.netatmo.com/oauth2/token', {
            method: 'POST',
            body,
        });
        if(!response.ok || response.status !== 200) {
            console.error('Failed to refresh token.');
            return;
        }
        const data = await response.json() as NetatmoTokenResponse;
        this.config.token = data.access_token;
        this.config.expires = Date.now() + (data.expires_in * 1000);
        this.config.refresh_token = data.refresh_token;
        await this.updateConfig();
        this.initRefresh();
    }

    get needsAuth() {
        return !this.config.token;
    }

    unInit() {
        if(this.refreshInterval) {
            clearTimeout(this.refreshInterval);
        }
    }

    async* authenticate(scopes: NetatmoScope[], redirectUri: string) {
        const state = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16);
        const redirectionTarget: string = yield `https://api.netatmo.com/oauth2/authorize?client_id=${this.config.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes.join('+')}&state=${encodeURIComponent(state)}`;
        const parsedRedirectedURL = new URL(redirectionTarget);
        if(!parsedRedirectedURL.searchParams.has('state') || parsedRedirectedURL.searchParams.get('state') !== state || !parsedRedirectedURL.searchParams.has('code')) {
            throw new Error(`Authentication flow failed. Possible error: ${parsedRedirectedURL.searchParams.get('error')}`);
        }
        const code = parsedRedirectedURL.searchParams.get('code');
        if(!code) {
            throw new Error('Authentication flow could not retrieve the code.');
        }
        const body = new URLSearchParams();
        body.append('scope', scopes.join(' '));
        body.append('code', code);
        body.append('grant_type', 'authorization_code');
        body.append('client_id', this.config.client_id);
        body.append('client_secret', this.config.client_secret);
        body.append('redirect_uri', redirectUri);
        const response = await fetch(`https://api.netatmo.com/oauth2/token`, {
            method: 'POST',
            body,
        });
        if(!response.ok || response.status !== 200) {
            throw new Error('Authentication flow failed while retrieving token.');
        }
        const data = await response.json() as NetatmoTokenResponse;
        this.config.expires = Date.now() + (data.expires_in * 1000);
        this.config.token = data.access_token;
        this.config.refresh_token = data.refresh_token;
        await this.updateConfig();
        this.initRefresh();
    }

    private updateConfig() {
        return this.setConfig({
            expires: this.config.expires,
            refresh_token: this.config.refresh_token,
        });
    }

    async getHealthyHomeCoachData(deviceId?: string): Promise<NetatmoHealthyHomeCoachDevice[]> {
        if(!this.config.token) {
            throw new Error("Unauthorized");
        }
        const body = new URLSearchParams();
        if(deviceId) {
            body.append('device_id', deviceId);
        }
        const response = await fetch('https://api.netatmo.com/api/gethomecoachsdata', {
            method: 'POST',
            body,
            headers: {
                Authorization: `Bearer ${this.config.token}`
            }
        });
        if(!response.ok || response.status !== 200) {
            if (response.status === 403) {
                this.config.token = '';
            }
            return [];
        }
        const data = await response.json() as { body: { devices: NetatmoHealthyHomeCoachDevice[] }};
        if(!Array.isArray(data.body.devices)) {
            return [];
        }
        return data.body.devices;
    }

    async getStationsData(deviceId?: string): Promise<NetatmoStationDevice[]> {
        if(!this.config.token) {
            throw new Error("Unauthorized");
        }
        const body = new URLSearchParams();
        if(deviceId) {
            body.append('device_id', deviceId);
        }
        const response = await fetch('https://api.netatmo.com/api/getstationsdata', {
            method: 'POST',
            body,
            headers: {
                Authorization: `Bearer ${this.config.token}`
            }
        });
        if(!response.ok || response.status !== 200) {
            if (response.status === 403) {
                this.config.token = '';
            }
            return [];
        }
        const data = await response.json() as { body: { devices: NetatmoStationDevice[] }};
        if(!Array.isArray(data.body.devices)) {
            return [];
        }
        return data.body.devices;
    }
}
