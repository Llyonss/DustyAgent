// === 数据层 ===
// 职责：统一向API请求数据并缓存，是所有fetch的唯一出口

const cache = { graph: null, mental: {}, self: null, tools: null };

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function del(url, body) {
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const Data = {
  // 简单 GET（不走缓存）
  async _simpleGet(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    return r.json();
  },

  // —— infer 日志 ——
  async fetchLogs(instance) {
    return get('/api/logs?instance=' + encodeURIComponent(instance));
  },
  async fetchLog(instance, { turn, ts }) {
    let url = '/api/log?instance=' + encodeURIComponent(instance);
    if (turn != null) url += '&turn=' + turn;
    if (ts != null) url += '&ts=' + ts;
    return get(url);
  },


  // —— 读取 ——

  async fetchInstances() {
    return get('/api/instances');
  },

  async fetchGraph(force = false) {
    if (!force && cache.graph) return cache.graph;
    cache.graph = await get('/api/graph');
    return cache.graph;
  },

  async fetchMental(name) {
    if (!cache.mental[name]) {
      cache.mental[name] = await get('/api/room?name=' + encodeURIComponent(name));
    }
    return cache.mental[name];
  },

  async fetchSelf(instance) {
    cache.self = await get('/api/instance?name=' + encodeURIComponent(instance));
    return cache.self;
  },

  async fetchTools(instance) {
    cache.tools = await get('/api/tools?instance=' + encodeURIComponent(instance));
    return cache.tools;
  },

  async fetchModel(instance) {
    return get('/api/model?instance=' + encodeURIComponent(instance));
  },

  async fetchModelPresets(instance) {
    return get('/api/model-presets?instance=' + encodeURIComponent(instance));
  },

  async fetchHistory(instance) {
    return get('/api/history?instance=' + encodeURIComponent(instance));
  },

  async fetchMentalStories(name) {
    return get('/api/mental-stories?name=' + encodeURIComponent(name));
  },

  async fetchStoryEvents(instance, index) {
    return get(`/api/story-events?instance=${encodeURIComponent(instance)}&index=${index}`);
  },

  async fetchScreenshot() {
    return get('/api/screenshot');
  },

  async pollEvents(instance) {
    return get('/api/events?instance=' + encodeURIComponent(instance));
  },

  // —— 写入 ——

  async saveMental(name, suffix, content) {
    const r = await post('/api/room-save', { name, suffix, content });
    cache.mental = {}; // 清除心智缓存
    cache.graph = null;
    return r;
  },

  async saveSelf(instance, suffix, content) {
    const r = await post('/api/self-save', { instance, suffix, content });
    cache.self = null;
    cache.tools = null;
    return r;
  },

  async saveModel(instance, config, preset) {
    return post('/api/model', { instance, config, preset });
  },

  async sendEvent(instance, content) {
    return post('/api/events?instance=' + encodeURIComponent(instance), { content });
  },

  async retryEvent(instance) {
    return post('/api/events?instance=' + encodeURIComponent(instance), { retry: true });
  },

  async createInstance(name) {
    return post('/api/instances', { name });
  },

  async deleteInstance(name) {
    return del('/api/instances', { name });
  },

  async deleteEvent(instance, file, mode) {
    return del('/api/events', { instance, file, mode });
  },

  async deleteEvents(instance, files) {
    return del('/api/events', { instance, files });
  },

  async deleteCommit(instance, index) {
    return del('/api/commit', { instance, index });
  },

  async createBranch(instance, branchName, at) {
    return post('/api/branch', { instance, branchName, at });
  },

  async fetchBranches(instance) {
    return get('/api/branches?instance=' + encodeURIComponent(instance));
  },

  async deleteBranch(instance, branchName) {
    return del('/api/branch', { instance, branchName });
  },

  async stopLoop(instance) {
    return del('/api/loop?instance=' + encodeURIComponent(instance));
  },

  async restartService() {
    return post('/api/restart');
  }
};
