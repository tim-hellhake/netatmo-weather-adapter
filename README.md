# netatmo-weather-adapter
Netatmo Weather Station adapter for the [Mozilla IoT gateway](https://iot.mozilla.org).

Bridges the Netatmo Cloud REST API to the gateway so it can read data from Netatmo Weather Stations (and Health Coaches).

## Usage
Normally you will just want to install this from the add-ons list provided by the gateway.

### Setup
1. Set up your Netatmo Weather Station or Healthy Home Coach using the official Netatmo app. 
2. [Create a Netatmo app](https://dev.netatmo.com/myaccount/createanapp). After entering and saving information for the new app, copy the API Client ID and Client Secret.
3. Enter the credentials that you have collected in the last steps in the Netatmo Weather Station add-on configuration.
4. You should now see all the Netatmo Weather Stations and Healthy Home Coaches connected to the configured credentials in the device pairing screen.
