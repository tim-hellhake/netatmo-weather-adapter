# netatmo-weather-adapter
Netatmo Weather Station adapter for the [Mozilla IoT gateway](https://iot.mozilla.org).

Bridges the Netatmo Cloud REST API  to the gateway so it can read data from Netatmo Weather Stations (and Health Coaches).

## Usage
Normally you will just want to install this from the add-ons list provided by the gateway.

### Setup
1. Before attempting to add to the gateway, you need to do the normal setup of your Netatmo Weather Station (set it up on your wifi, create a Netatmo username & password, ...). 
2. Then you need to [create a Netatmo app](https://dev.netatmo.com/myaccount/createanapp). After entering and saving information for the new app, it will generate a client id and client secret (save these). 
3. Back on the gateway in the Netatmo Weather Station add-on (Settings -> Add-ons -> Netatmo Weather Station -> Configure), enter all the requested credentials and save them. 
4. You should now see all the Netatmo Weather Stations and Healthy Home Coaches connected to the configured credentials in the device pairing screen.
