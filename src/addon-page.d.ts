/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export {}

declare class Extension {
    constructor(packageName: string)

    view: HTMLElement;
    id: string;
}
interface API {
    postJson(route: string, data: any): Promise<void>;
}

declare global {
    interface Window {
        Extension: typeof Extension;
        API: API;
    }

    interface URLSearchParams {
        entries(): [string, string][]
    }
}
