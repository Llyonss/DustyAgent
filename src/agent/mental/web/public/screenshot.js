// === 屏幕预览 ===
// 远程访问时查看本地电脑屏幕，手动刷新

import { Data } from './data.js';

export const Screenshot = {
  visible: false,

  init() {
    this.el = document.getElementById('screenshotPanel');
    this.img = document.getElementById('screenshotImg');
    this.btn = document.getElementById('btnScreenshot');
    this.refreshBtn = document.getElementById('btnScreenshotRefresh');

    this.btn.addEventListener('click', () => this.toggle());
    document.getElementById('btnScreenshotClose').addEventListener('click', () => this.hide());
    this.refreshBtn.addEventListener('click', () => this._fetch());

    // 拖拽
    this._dragging = false;
    this.el.querySelector('.screenshot-header').addEventListener('mousedown', e => {
      this._dragging = true;
      this._dragOffset = { x: e.clientX - this.el.offsetLeft, y: e.clientY - this.el.offsetTop };
    });
    document.addEventListener('mousemove', e => {
      if (!this._dragging) return;
      this.el.style.left = (e.clientX - this._dragOffset.x) + 'px';
      this.el.style.top = (e.clientY - this._dragOffset.y) + 'px';
      this.el.style.right = 'auto';
      this.el.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { this._dragging = false; });
  },

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  },

  show() {
    this.visible = true;
    this.el.classList.remove('hidden');
    this.img.style.opacity = '0.3';
    this._fetch();
  },

  hide() {
    this.visible = false;
    this.el.classList.add('hidden');
  },

  async _fetch() {
    this.img.style.opacity = '0.5';
    this.refreshBtn.disabled = true;
    try {
      const data = await Data.fetchScreenshot();
      if (data?.image) {
        this.img.src = 'data:image/jpeg;base64,' + data.image;
        this.img.style.opacity = '1';
      } else {
        this.img.style.opacity = '0.3';
      }
    } catch (e) {
      this.img.style.opacity = '0.3';
    } finally {
      this.refreshBtn.disabled = false;
    }
  }
};
