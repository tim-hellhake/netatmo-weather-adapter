# netatmo-weather-adapter
Netatmo Weather Station adapter for the [Mozilla IoT gateway](https://iot.mozilla.org).

Bridges the Netatmo REST API to the gateway so it can read data from Netatmo Weather Stations (and Health Coaches).

## Usage
Normally you will just want to install this from the add-ons list provided by
the gateway.

### Setup
Enter the API credentials for your [Netatmo Smart Home](https://www.netatmo.com/site/connect/program#home) system in order for the adapter to read your station data.

To do so, navigate to the adapter configuration on your Things Gateway dashboard. (/settings/addons/config/netatmo-weather-adapter)
After entering your credentials, your stations should be found and can be added as new Things.
