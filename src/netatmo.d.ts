/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

declare module 'netatmo' {
    export default class Netatmo {
        constructor(config: any);
        getStationsData(callback: (err: any, data: Station[]) => void): void;
        getStationsData(data: { device_id: string }, callback: (err: any, data: Station[]) => void): void;
        getHealthyHomeCoachData(callback: (err: any, coaches: Coach[]) => void): void;
        getHealthyHomeCoachData(data: { device_id: string }, callback: (err: any, coaches: Coach[]) => void): void;
    }
}

interface Station {
    modules: Module[]
}

interface Module {
    _id: string
}

interface Coach {
}
