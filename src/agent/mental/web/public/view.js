// === 视图控制 ===
// 职责：控制所有视图切换和移动端适配

export const View = {
  current: 'graph',      // 'graph' | 'content' | 'story'
  mobileTab: 'chat',     // 'chat' | 'mental'

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
    document.querySelectorAll('.mobile-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab)
    );
    if (tab === 'chat') {
      chatPanel.classList.remove('mobile-hidden');
      mentalPanel.classList.remove('mobile-show');
    } else {
      chatPanel.classList.add('mobile-hidden');
      mentalPanel.classList.add('mobile-show');
      setTimeout(() => {
        if (window._graphRender) window._graphRender();
      }, 50);
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
