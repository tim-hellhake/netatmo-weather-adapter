/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

declare module 'gateway-addon' {
    class Event {
        constructor(device: any, name: string, data?: any);
    }

    interface EventDescription {
        name: string;
        metadata: EventMetadata;
    }

    interface EventMetadata {
        description: string,
        type: string
    }

    class Property {
        public value: any
        public device: Device;
        public readOnly: boolean;
        public enum: string[];
        constructor(device: Device, name: string, propertyDescr: {});
        public setCachedValue(value: any): void;
        public setCachedValueAndNotify(value: any): void;
        public setValue(value: any): Promise<void>
    }

    class Device {
        protected '@context': string;
        protected '@type': string[];
        public id: string;
        protected name: string;
        protected description: string;
        protected adapter: Adapter;
        protected links: { rel: string; mediaType: string; href: string; }[];

        constructor(adapter: Adapter, id: string);

        public properties: Map<String, Property>;
        public notifyPropertyChanged(property: Property): void;
        public addAction(name: string, metadata: any): void;
        public connectedNotify(connected: boolean): void;

        public events: Map<String, EventDescription>;
        public eventNotify(event: Event): void;
        public setTitle(name: any): void;
        public findProperty(propertyName: string): Property;
    }

    class Adapter {
        public devices: { [id: string]: Device };

        constructor(addonManager: any, id: string, packageName: string);

        public handleDeviceAdded(device: Device): void;
        public handleDeviceRemoved(device: Device): void;
        public updateDevice(device: Device): void;
        public removeThing(device: Device): void;
        public startPairing(_timeoutSeconds: number): void;
        public getDevice(_id: any): any;
        public unload(): void;
        public sendPairingPrompt(message: string, url?: string): void;
    }

    class Database {
        constructor(packageName: string, path?: string);

        public open(): Promise<void>;
        public loadConfig(): Promise<any>;
        public saveConfig(config: any): Promise<void>;
        public close(): void;
    }

    class APIResponse {
        constructor({ status, contentType, content }?: { status: number, contentType?: string, content?: string });

        getStatus(): number;
        getContentType(): string | undefined;
        getContent(): string | undefined;
        asDict(): { status: number, contentType?: string, content?: string };
    }

    class APIRequest {
        getMethod(): string;
        getPath(): string;
        getQuery(): Record<string, unknown>;
        getBody(): Record<string, unknown>;
    }

    class APIHandler {
        constructor(addonManageR: any, packageName: string, { verbose }?: Record<string, unknown>);

        isVerbose(): boolean;
        getPackageName(): string;
        getGatewayVersion(): string | undefined;
        handleRequest(request: APIRequest): Promise<APIResponse>;
        unload: Promise<void>;
    }
}
