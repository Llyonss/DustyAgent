// === 视图控制 ===
// 职责：控制所有视图切换和移动端适配

export const View = {
  current: 'graph',      // 'graph' | 'content' | 'story'
  mobileTab: 'chat',     // 'chat' | 'mental' | 'terminal'

  // —— 主区域三视图切换 ——
  showGraph() {
    this.current = 'graph';
    document.getElementById('graphView').classList.remove('hidden');
    document.getElementById('contentView').classList.add('hidden');
    document.getElementById('storyView').classList.add('hidden');
    document.getElementById('systemPromptSection').classList.add('hidden');
    document.getElementById('toolsSection').classList.add('hidden');
    document.getElementById('editArea').classList.add('hidden');
    document.getElementById('contentScroll').style.display = '';
    this.updateMobileTitle('心智图谱');
  },

  showContent() {
    this.current = 'content';
    document.getElementById('graphView').classList.add('hidden');
    document.getElementById('contentView').classList.remove('hidden');
    document.getElementById('storyView').classList.add('hidden');
  },

  showStory() {
    this.current = 'story';
    document.getElementById('graphView').classList.add('hidden');
    document.getElementById('contentView').classList.add('hidden');
    document.getElementById('storyView').classList.remove('hidden');
  },

  // —— 移动端 ——
  switchTab(tab) {
    const chatPanel = document.getElementById('chatPanel');
    const mentalPanel = document.getElementById('mentalPanel');
    const terminalPanel = document.getElementById('terminalPanel');
    document.querySelectorAll('.mobile-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab)
    );
    // 隐藏所有
    chatPanel.classList.remove('mobile-hidden');
    chatPanel.classList.remove('mobile-term');
    mentalPanel.classList.remove('mobile-show');
    terminalPanel?.classList.remove('terminal-open');
    // 显示目标
    if (tab === 'chat') {
      // chatPanel 默认可见
    } else if (tab === 'mental') {
      chatPanel.classList.add('mobile-hidden');
      mentalPanel.classList.add('mobile-show');
      setTimeout(() => {
        if (window._graphRender) window._graphRender();
      }, 50);
    } else if (tab === 'terminal') {
      // 移动端：显示 chatPanel 但只露出终端
      chatPanel.classList.add('mobile-term');
      terminalPanel?.classList.add('terminal-open');
      if (window._terminalOpen) window._terminalOpen();
    }
    this.closeSidebar();
    this.mobileTab = tab;
  },

  toggleSidebar() {
    const sidebar = document.getElementById('mentalSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar.classList.contains('sidebar-open')) {
      this.closeSidebar();
    } else {
      sidebar.classList.add('sidebar-open');
      overlay.classList.add('open');
    }
  },

  closeSidebar() {
    document.getElementById('mentalSidebar')?.classList.remove('sidebar-open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
  },

  updateMobileTitle(text) {
    const mt = document.querySelector('.mental-mobile-title');
    if (mt) mt.textContent = text;
  }
};
