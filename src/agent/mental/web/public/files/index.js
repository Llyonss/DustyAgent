// === 文件浏览器 ===
// 职责：查看文件内容（md渲染/代码高亮/图片预览）。树导航由 unified-tree.js 统一处理。

import { Data } from '../data.js';
import { View } from '../view.js';
import { DustyRenderer } from '../dusty-renderer/index.js';

let currentFile = null;
let currentViewMode = 'dataflow';
let currentFileData = null;

export const Files = {

  async openFile(filePath, fileName) {
    currentFile = filePath;
    currentViewMode = 'dataflow';

    document.getElementById('filePath').textContent = filePath;
    const body = document.getElementById('fileBody');
    body.innerHTML = '<div class="empty">加载中...</div>';

    try {
      const data = await Data.fetchFile(filePath);
      currentFileData = data;
      this._renderFile(data);
    } catch (e) {
      currentFileData = null;
      body.innerHTML = `<div class="empty">无法读取: ${window.esc(e.message)}</div>`;
    }
  },

  _renderFile(data) {
    const body = document.getElementById('fileBody');
    const bar = document.getElementById('filePath');
    bar.dataset.absPath = data.absPath || '';

    if (data.binary) {
      body.innerHTML = `<img src="data:${data.mime};base64,${data.content}" class="file-image" alt="preview">`;
      this._updateToggleBtn(false);
      return;
    }

    if (data.ext === 'md') {
      window.mdTo(body, data.content);
      this._updateToggleBtn(false);
      return;
    }

    const isCode = ['js','mjs','cjs','jsx','ts','mts','cts','ts'].includes(data.ext);
    const hasMarkers = DustyRenderer.hasDustyMarkers(data.content);
    const canVisualize = isCode || hasMarkers;

    this._updateToggleBtn(canVisualize);

    if (!canVisualize) {
      currentViewMode = 'code';
      body.innerHTML = this._renderRawCode(data.content, data.ext);
      return;
    }

    if (currentViewMode === 'code') {
      body.innerHTML = this._renderRawCode(data.content, data.ext);
    } else {
      DustyRenderer.renderTo(body, data.content, { ext: data.ext });
    }
  },

  _renderRawCode(content, ext) {
    const escaped = (content || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre class="file-code"><code class="language-${ext}">${escaped}</code></pre>`;
  },

  _updateToggleBtn(show) {
    const btn = document.getElementById('btnFileToggleView');
    if (!btn) return;
    if (!show) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    btn.textContent = currentViewMode === 'dataflow' ? '🔄 代码' : '🔄 数据流';
  },

  toggleView() {
    if (!currentFileData) return;
    currentViewMode = currentViewMode === 'dataflow' ? 'code' : 'dataflow';
    this._updateToggleBtn(true);
    this._renderFile(currentFileData);
  },
};
