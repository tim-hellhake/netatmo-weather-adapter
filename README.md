# netatmo-weather-adapter
Netatmo Weather Station adapter for the [Mozilla IoT gateway](https://iot.mozilla.org).

Bridges the Netatmo REST API (via netatmo.com, not the local Netatmo device) to the gateway so it can read data from Netatmo Weather Stations (and Health Coaches).

## Usage
In order for your gateway to read data for your Netatmo Weather Station, you need to follow the Netatmo Weather Station setup instructions provided by Netatmo. Then install and configure this from the add-ons list provided by the gateway (Settings -> Add-ons -> Netatmo Weather Station).

### Setup
Before attempting to add to the gateway, you need to do the normal setup of your Netatmo Weather Station (set it up on your wifi, create a Netatmo username & password, ...). Then you need to [create a Netatmo app](https://dev.netatmo.com/myaccount/createanapp). After entering and saving information for the new app, it will generate a Client id and Client secret (save these). Back on the gateway in the Netatmo Weather Station add-on (Settings -> Add-ons -> Netatmo Weather Station -> Configure), enter all the requested credentials and Apply them. On the Things screen, click + to scan for new Things and the Netatmo Weather Station sensors should now be found and can be added as new Things.
