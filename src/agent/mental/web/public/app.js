// === 心智前端 — 入口 ===
// 职责：初始化启动，连接所有模块

import { Data } from './data.js';
import { Instance } from './instance.js';
import { View } from './view.js';
import { Graph } from './graph/index.js';
import { Tree } from './graph/tree.js';
import { Content } from './content/index.js';
import { Chat } from './chat/index.js';
import { Preset } from './preset.js';
import { Screenshot } from './screenshot.js';
import { Usage } from './usage.js';
import { Logs } from './logs.js';
import { Terminal } from './terminal.js';

// 全局工具函数
window.esc = function(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

// —— Markdown 渲染（含 Mermaid） ——
mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    primaryColor: '#1a1a24',
    primaryTextColor: '#c8c8d0',
    primaryBorderColor: '#2a2a30',
    lineColor: '#555',
    secondaryColor: '#121218',
    tertiaryColor: '#0e0e10',
    nodeBorder: '#7c6fe0',
    clusterBkg: '#121218',
    clusterBorder: '#2a2a30',
    titleColor: '#e0e0e8',
    edgeLabelBackground: '#12121a',
  }
});

const mdRenderer = new marked.Renderer();
const origCode = mdRenderer.code.bind(mdRenderer);
mdRenderer.code = function({ text, lang }) {
  if (lang === 'mermaid') return `<div class="mermaid">${text}</div>`;
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<pre><code class="language-${lang || ''}">${escaped}</code></pre>`;
};
marked.setOptions({ renderer: mdRenderer });

// 纯函数：markdown → HTML 字符串
window.md = function(s) { try { return marked.parse(s || ''); } catch { return '<pre>' + window.esc(s) + '</pre>'; } };

// 写入 DOM：含 mermaid 渲染
window.mdTo = function(el, s) {
  el.innerHTML = window.md(s);
  mermaid.run({ nodes: el.querySelectorAll('.mermaid:not([data-processed])') });
};

// —— 移动端键盘适配：visualViewport 动态高度 ——
// 键盘弹出时 visualViewport 缩小，body 高度同步缩小 → 输入框紧贴键盘
if (window.visualViewport) {
  const adaptViewport = () => {
    document.body.style.height = window.visualViewport.height + 'px';
    // 部分浏览器键盘弹出时会滚动页面，强制归位
    if (window.visualViewport.offsetTop > 0) {
      window.scrollTo(0, 0);
    }
  };
  window.visualViewport.addEventListener('resize', adaptViewport);
  window.visualViewport.addEventListener('scroll', adaptViewport);
  adaptViewport();
}

const App = {
  async init() {
    bindEvents();

    await Instance.init();
    await Preset.init();

    // 终端初始化
    Terminal.init(document.getElementById('terminalContainer'));
    window._terminalOpen = () => Terminal.open();

    // visualViewport 变化时 refit 终端
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        setTimeout(() => Terminal.refit(), 100);
      });
    }

    const graphData = await Data.fetchGraph();
    Graph.render(graphData);
    Tree.renderMental(graphData);

    Screenshot.init();
    Usage.init();
    Logs.init();
    Chat.startPoll();
  }
};

function bindEvents() {
  document.getElementById('instanceSelect').addEventListener('change', () => {
    Instance.switch(document.getElementById('instanceSelect').value);
  });
  document.getElementById('btnNewInstance').addEventListener('click', () => Instance.create());
  document.getElementById('btnDeleteInstance').addEventListener('click', () => Instance.remove());
  document.getElementById('btnRestart').addEventListener('click', () => Instance.restart());

  document.getElementById('sendBtn').addEventListener('click', () => Chat.send());
  document.getElementById('stopBtn').addEventListener('click', () => Chat.abort());
  document.getElementById('btnHistory').addEventListener('click', () => Chat.toggleHistory());
  const chatInput = document.getElementById('chatInput');
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Chat.send(); }
  });
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  document.querySelectorAll('.mobile-tab').forEach(t => {
    t.addEventListener('click', () => View.switchTab(t.dataset.tab));
  });
  document.getElementById('btnToggleSidebar').addEventListener('click', () => View.toggleSidebar());
  document.getElementById('sidebarOverlay').addEventListener('click', () => View.closeSidebar());

  document.getElementById('btnShowGraph').addEventListener('click', () => Content.showGraph());
  document.getElementById('btnEditContent').addEventListener('click', () => Content.editContent());
  document.getElementById('btnEditLinks').addEventListener('click', () => Content.editLinks());
  document.getElementById('btnBackToGraph').addEventListener('click', () => Content.showGraph());
  document.getElementById('btnMentalStories').addEventListener('click', () => Content.showRelatedStories());

  document.getElementById('btnSelf').addEventListener('click', () => Content.select('self'));
  document.getElementById('modelToggle').addEventListener('click', () => Content.toggleModel());
  document.getElementById('btnEditModel').addEventListener('click', e => { e.stopPropagation(); Content.editModel(); });
  document.getElementById('btnModelSave').addEventListener('click', () => Content.saveModel());
  document.getElementById('btnModelCancel').addEventListener('click', () => Content.cancelModel());
  document.getElementById('systemPromptToggle').addEventListener('click', () => Content.toggleSystemPrompt());
  document.getElementById('btnEditSystem').addEventListener('click', e => { e.stopPropagation(); Content.editSystem(); });
  document.getElementById('toolsToggle').addEventListener('click', () => Content.toggleTools());
  document.getElementById('btnNewTool').addEventListener('click', e => { e.stopPropagation(); Content.newTool(); });

  document.getElementById('btnSaveEdit').addEventListener('click', () => Content.saveEdit());
  document.getElementById('btnCancelEdit').addEventListener('click', () => Content.cancelEdit());
  document.getElementById('editTextarea').addEventListener('keydown', e => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); Content.saveEdit(); }
    if (e.key === 'Escape') Content.cancelEdit();
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target, s = ta.selectionStart;
      ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 2;
    }
  });

  document.getElementById('btnStoryBack').addEventListener('click', () => Content.showGraph());

  // 分支树弹窗关闭
  document.getElementById('btnBranchTreeClose')?.addEventListener('click', () => Chat.closeBranchTree());
  document.getElementById('branchTreeModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) Chat.closeBranchTree();
  });

  // 桌面端终端切换
  document.getElementById('btnTerminal')?.addEventListener('click', () => {
    const panel = document.getElementById('terminalPanel');
    if (!panel) return;
    const isOpen = panel.classList.toggle('terminal-open');
    if (isOpen) {
      Terminal.open();
      setTimeout(() => Terminal.refit(), 100);
    }
  });
  document.getElementById('btnTermClose')?.addEventListener('click', () => {
    const panel = document.getElementById('terminalPanel');
    if (panel) panel.classList.remove('terminal-open');
    // 移动端切回对话
    if (View.mobileTab === 'terminal') View.switchTab('chat');
  });

  // 终端控制按钮
  document.getElementById('btnTermStop')?.addEventListener('click', () => Terminal.stop());
  document.getElementById('btnTermCopy')?.addEventListener('click', () => Terminal.copy());
  document.getElementById('btnTermRestart')?.addEventListener('click', () => Terminal.restart());
}

App.init();
