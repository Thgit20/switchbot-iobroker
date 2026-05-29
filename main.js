const utils = require("@iobroker/adapter-core");
const API = require("./lib/api");
const Queue = require("./lib/queue");
const startWebhook = require("./lib/webhook");

class Switchbot extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: "switchbot" });

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
    }

    async onReady() {
        this.api = new API(this.config);
        this.queue = new Queue(this);
        this.devices = {};
        
        startWebhook(this);

        await this.syncDevices();

        this.setInterval(() => {
            this.update();
        }, this.config.interval * 1000);
    }

    async syncDevices() {
        const res = await this.api.getDevices();
        const devices = res.data.body.deviceList;

        for (const d of devices) {
            const id = d.deviceId;

            await this.setObjectNotExistsAsync(id, {
                type: "device",
                common: { name: d.deviceName },
                native: d
            });

            if (d.deviceType === "Curtain") {
                await this.setObjectNotExistsAsync(`${id}.position`, {
                    type: "state",
                    common: { type: "number", role: "blind", read: true, write: true }
                });
            } else {
                await this.setObjectNotExistsAsync(`${id}.power`, {
                    type: "state",
                    common: { type: "boolean", role: "switch", read: true, write: true }
                });
            }
        }

        this.devices = devices;
    }

   async smartUpdate() {
    for (const id in this.devices) {
        const d = this.devices[id];

        const noWebhook = Date.now() - d.lastUpdate > 10 * 60 * 1000;

        if (!noWebhook) continue;

        if (!this.canUseAPI()) return;

        try {
            const res = await this.api.status(id);
            const s = res.data.body;

            d.lastUpdate = Date.now();

            if (s.power !== undefined) {
                await this.setStateAsync(
                    `${id}.power`,
                    s.power === "on",
                    true
                );
            }

        } catch {
            this.log.debug(`Skip ${id}`);
        }
    }
}

    async onStateChange(id, state) {
        if (!state || state.ack) return;

        const [,, deviceId, dp] = id.split(".");

        let body;

        if (dp === "power") {
            body = {
                command: state.val ? "turnOn" : "turnOff",
                parameter: "default",
                commandType: "command"
            };
        }

        if (dp === "position") {
            body = {
                command: "setPosition",
                parameter: `0,ff,${state.val}`,
                commandType: "command"
            };
        }

        if (!body) return;

        this.queue.push(() => this.api.command(deviceId, body));

        await this.setStateAsync(id, state.val, true);
    }
}

if (module.parent) {
    module.exports = options => new Switchbot(options);
} else {
    new Switchbot();
}
this.apiCounter = 0;
this.apiReset = Date.now();

function canUseAPI() {
    if (Date.now() - this.apiReset > 86400000) {
        this.apiCounter = 0;
        this.apiReset = Date.now();
    }

    if (this.apiCounter >= 900) {
        this.log.warn("API Limit fast erreicht!");
        return false;
    }

    this.apiCounter++;
    return true;
}
