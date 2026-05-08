const Notify = {
  ws: null,
  handlers: new Map(),

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}`);
    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const handlers = this.handlers.get(data.event);
        if (handlers) handlers.forEach(fn => fn(data));
      } catch {}
    };
    this.ws.onclose = () => setTimeout(() => this.connect(), 2000);
  },

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }
};
