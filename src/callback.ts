/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

import { APIHandler, APIRequest, APIResponse } from 'gateway-addon';

enum CallbackType {
    CALLBACK_SUCCEEDED,
}

interface CallbackMessage {
    type: CallbackType;
    data: unknown;
}

export class CallbackAPIHandler extends APIHandler {
    private listeners: Map<string, CallbackListener>;

    constructor(addonManager: any, packageName: string) {
        super(addonManager, packageName);
        addonManager.addAPIHandler(this);

        this.listeners = new Map<string, CallbackListener>();
    }

    addListener(listener: CallbackListener) {
        this.listeners.set(listener.id, listener);
    }

    removeListener(listener: CallbackListener) {
        this.listeners.delete(listener.id);
    }

    emit(message: CallbackMessage) {
        for (const listener of this.listeners.values()) {
            listener.handleEvent(message);
        }
    }

    async handleRequest(request: APIRequest) {
        if (request.getMethod() !== 'POST' && request.getPath() !== '/callback') {
            return new APIResponse({ status: 404 });
        }

        this.emit({
            type: CallbackType.CALLBACK_SUCCEEDED,
            data: request.getBody(),
        });

        return new APIResponse({
            status: 200,
            contentType: 'application/json',
            content: JSON.stringify({}),
        });
    }
}

export class CallbackListener {
    public successPromise: Promise<unknown>;
    private resolvePromise?: (value: unknown) => void;

    constructor(public id: string) {
        this.successPromise = new Promise((resolve) => {
            this.resolvePromise = resolve;
        });
    }

    handleEvent(message: CallbackMessage) {
        if (message.type === CallbackType.CALLBACK_SUCCEEDED) {
            this.resolvePromise?.(message.data);
        }
    }
}
