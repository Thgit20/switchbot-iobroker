const utils = require("@iobroker/adapter-core");
const API = require("./lib/api");
const Queue = require("./lib/queue");
const startWebhook = require("./lib/webhook");

class Switchbot extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: "switchbot" });

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));

        // ✅ Optimierungen
        this.lastCommands = {};
        this.commandCooldown = {};
        this.devices = {};
        this.apiCounter = 0;
        this.apiReset = Date.now();
    }

    // ✅ API LIMIT CONTROLLER
    canUseAPI() {
        if (Date.now() - this.apiReset > 86400000) {
            this.apiCounter = 0;
            this.apiReset = Date.now();
        }

        if (this.apiCounter >= 900) {
            this.log.warn("⚠️ API Limit fast erreicht!");
            return false;
        }

        this.apiCounter++;
        return true;
    }

    async onReady() {
        this.log.info("SwitchBot Adapter gestartet");

        this.api = new API(this.config);
        this.queue = new Queue(this);

        // ✅ Webhook starten
        startWebhook(this);

        // ✅ States anlegen
        await this.setObjectNotExistsAsync("info.connection", {
            type: "state",
            common: {
                type: "boolean",
                role: "indicator.connected",
                read: true,
                write: false
            }
        });

        await this.setObjectNotExistsAsync("info.apiUsage", {
            type: "state",
            common: {
                type: "number",
                role: "value",
                read: true,
                write: false
            }
        });

        await this.loadDevices();

        // ✅ Adaptive Polling
        this.setInterval(() => {
            this.smartUpdate();
        }, (this.config.interval || 300) * 1000);
    }

    // ✅ Geräte laden (nur 1x!)
    async loadDevices() {
        if (!this.canUseAPI()) return;

        try {
            const res = await this.api.getDevices();
            const list = res.data.body.deviceList;

            for (const d of list) {
                const id = d.deviceId;

                this.devices[id] = {
                    ...d,
                    lastUpdate: 0
                };

                await this.setObjectNotExistsAsync(id, {
                    type: "device",
                    common: { name: d.deviceName },
                    native: d
                });

                if (d.deviceType === "Curtain") {
                    await this.setObjectNotExistsAsync(`${id}.position`, {
                        type: "state",
                        common: {
                            type: "number",
                            role: "level.blind",
                            min: 0,
                            max: 100,
                            read: true,
                            write: true
                        }
                    });
                } else {
                    await this.setObjectNotExistsAsync(`${id}.power`, {
                        type: "state",
                        common: {
                            type: "boolean",
                            role: "switch",
                            read: true,
                            write: true
                        }
                    });
                }
            }

            await this.setStateAsync("info.connection", true, true);

        } catch (e) {
            this.log.error("Fehler beim Laden der Geräte");
            await this.setStateAsync("info.connection", false, true);
        }
    }

    // ✅ SMART POLLING
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

                if (s.slidePosition !== undefined) {
                    await this.setStateAsync(
                        `${id}.position`,
                        s.slidePosition,
                        true
                    );
                }

            } catch {
                this.log.debug(`Skip update ${id}`);
            }
        }

        await this.setStateAsync("info.apiUsage", this.apiCounter, true);
    }

    // ✅ RETRY HELPER
    async safeCommand(fn, retries = 2) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch {
                if (i === retries - 1) throw new Error("Command failed");
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    // ✅ STATE CHANGE (MIT ALLEN OPTIMIERUNGEN)
    async onStateChange(id, state) {
        if (!state || state.ack) return;

        const parts = id.split(".");
        const deviceId = parts[2];
        const dp = parts[3];

        const key = deviceId + "." + dp;

        // ✅ COMMAND OPTIMIZER
        if (this.lastCommands[key] === state.val) {
            this.log.debug(`Skip duplicate: ${key}`);
            return;
        }

        this.lastCommands[key] = state.val;

        // ✅ AUTO RESET
        setTimeout(() => delete this.lastCommands[key], 5000);

        // ✅ COOLDOWN
        if (this.commandCooldown[deviceId]) {
            this.log.debug("Cooldown aktiv");
            return;
        }

        this.commandCooldown[deviceId] = true;
        setTimeout(() => {
            this.commandCooldown[deviceId] = false;
        }, 1500);

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

        // ✅ API prüfen
        if (!this.canUseAPI()) return;

        // ✅ Queue + Retry
        this.queue.push(() =>
            this.safeCommand(() => this.api.command(deviceId, body))
        );

        await this.setStateAsync(id, state.val, true);
    }
}

if (module.parent) {
    module.exports = options => new Switchbot(options);
} else {
    new Switchbot();
}

