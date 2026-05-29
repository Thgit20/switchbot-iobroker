class Queue {
    constructor(adapter) {
        this.adapter = adapter;
        this.q = [];
        this.running = false;
    }

    push(job) {
        this.q.push(job);
        this.run();
    }

    async run() {
        if (this.running) return;
        this.running = true;

        while (this.q.length) {
            const job = this.q.shift();
            try {
                await job();
                await new Promise(r => setTimeout(r, 800));
            } catch (e) {
                this.adapter.log.warn("Queue error");
            }
        }

        this.running = false;
    }
}

module.exports = Queue;
