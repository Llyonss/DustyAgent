// === 用量仪表盘 ===
// 职责：顶栏指示器 + 弹窗 + 数据获取

import { Data } from './data.js';

const THRESHOLDS = { low: 0.5, medium: 0.8 };

function pctLevel(pct) {
  if (pct >= THRESHOLDS.medium) return 'high';
  if (pct >= THRESHOLDS.low) return 'medium';
  return 'low';
}

function fmtNum(n) {
  if (n == null) return '\u2014';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n == null) return '\u2014';
  return (n * 100).toFixed(1) + '%';
}

function countdownStr(target) {
  if (!target) return '';
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return '重置中...';
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return days + '天 ' + (hrs % 24) + 'h 后重置';
  if (hrs > 0) return hrs + 'h ' + (mins % 60) + 'min 后重置';
  return mins + 'min 后重置';
}

export const Usage = {
  data: null,
  timer: null,
  _countdownTimer: null,

  async init() {
    document.getElementById('usageIndicator').addEventListener('click', () => this.openModal());
    document.getElementById('btnUsageClose').addEventListener('click', () => this.closeModal());
    document.getElementById('btnUsageRefresh').addEventListener('click', () => this.fetch(true));
    document.getElementById('usageModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
    await this.fetch();
    this.startPolling();
  },

  startPolling() {
    this.stopPolling();
    this.timer = setInterval(() => this.fetch(), 60000);
  },

  stopPolling() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
  },

  async fetch(showLoading) {
    try {
      const raw = await Data._simpleGet('/api/zenmux/subscription');
      if (!raw.available) {
        this.data = null;
        document.getElementById('usageIndicator').classList.add('hidden');
        return;
      }
      if (raw.error) {
        this.data = { _error: raw.error };
        this.updateIndicatorError();
        return;
      }
      this.data = raw.data || raw;
      this.updateIndicator();
    } catch (e) {
      this.data = { _error: e.message };
      this.updateIndicatorError();
    }
  },

  _getWorstLevel() {
    const d = this.data;
    if (!d) return 'low';
    const pcts = [];
    if (d.quota_5_hour && d.quota_5_hour.usage_percentage != null)
      pcts.push(d.quota_5_hour.usage_percentage);
    if (d.quota_7_day && d.quota_7_day.usage_percentage != null)
      pcts.push(d.quota_7_day.usage_percentage);
    if (!pcts.length) return 'low';
    return pctLevel(Math.max.apply(null, pcts));
  },

  updateIndicator() {
    var el = document.getElementById('usageIndicator');
    var d = this.data;
    if (!d) { el.classList.add('hidden'); return; }

    var pct5 = d.quota_5_hour && d.quota_5_hour.usage_percentage;
    var pct7 = d.quota_7_day && d.quota_7_day.usage_percentage;
    var tier = d.plan ? (d.plan.tier || '') : '';
    tier = tier.charAt(0).toUpperCase() + tier.slice(1);

    var textEl = el.querySelector('.usage-text');
    var dotEl = el.querySelector('.usage-dot');

    var parts = [];
    if (pct5 != null) parts.push('5h ' + fmtPct(pct5));
    if (pct7 != null) parts.push('7d ' + fmtPct(pct7));
    if (tier) parts.push(tier);

    textEl.textContent = parts.join(' \u00b7 ');
    dotEl.className = 'usage-dot ' + this._getWorstLevel();
    el.classList.remove('hidden');
  },

  updateIndicatorError() {
    var el = document.getElementById('usageIndicator');
    el.querySelector('.usage-text').textContent = '用量 \u2014';
    el.querySelector('.usage-dot').className = 'usage-dot error';
    el.classList.remove('hidden');
  },

  openModal() {
    document.getElementById('usageModal').classList.remove('hidden');
    this._renderModal();
    if (!this.data || this.data._error) this.fetch(true);
    this._startCountdown();
  },

  closeModal() {
    document.getElementById('usageModal').classList.add('hidden');
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  _startCountdown() {
    var self = this;
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this._countdownTimer = setInterval(function() {
      if (document.getElementById('usageModal').classList.contains('hidden')) {
        clearInterval(self._countdownTimer);
        self._countdownTimer = null;
        return;
      }
      self._renderModal();
    }, 1000);
  },

  _renderModal() {
    var body = document.getElementById('usageBody');
    var d = this.data;

    if (!d) {
      body.innerHTML = '<div class="usage-skeleton"><div class="usage-skeleton-line w60"></div><div class="usage-skeleton-line w80"></div><div class="usage-skeleton-card"></div><div class="usage-skeleton-card"></div><div class="usage-skeleton-card"></div></div>';
      return;
    }

    if (d._error) {
      body.innerHTML = '<div class="usage-error">\u26a0\ufe0f 获取失败: ' + window.esc(d._error) + '<br><small>请检查 Management API Key 配置</small></div>';
      return;
    }

    var status = d.account_status || 'healthy';
    var statusLabels = {
      healthy: '\ud83d\udfe2 账户正常',
      monitored: '\ud83d\udfe1 账户监控中 \u2014 服务可用',
      abusive: '\ud83d\udfe0 使用异常 \u2014 已限制',
      suspended: '\ud83d\udd34 账户已暂停',
      banned: '\u26d4 账户已封禁'
    };
    var tier = (d.plan && d.plan.tier) ? d.plan.tier : 'unknown';
    var tierDisplay = tier.charAt(0).toUpperCase() + tier.slice(1);
    var planInfo = tierDisplay + ' \u00b7 $' + (d.plan ? d.plan.amount_usd || '\u2014' : '\u2014') + '/月 \u00b7 到期 ' + (d.plan && d.plan.expires_at ? new Date(d.plan.expires_at).toLocaleDateString('zh-CN') : '\u2014');
    var rate = d.effective_usd_per_flow != null ? '$' + Number(d.effective_usd_per_flow).toFixed(5) + '/Flow' : '\u2014';

    var html = '<div class="usage-status-banner ' + status + '">' + (statusLabels[status] || status) + '</div>';
    html += '<div class="usage-plan-line">' + window.esc(planInfo) + ' \u00b7 费率 ' + rate + '</div>';

    html += this._renderQuotaCard('\u23f1 5小时滚动', d.quota_5_hour, 'rolling');
    html += this._renderQuotaCard('\ud83d\udcc5 7天滚动', d.quota_7_day, 'rolling');
    html += this._renderQuotaCard('\ud83d\udcc6 月度上限', d.quota_monthly, 'monthly');

    body.innerHTML = html;
  },

  _renderQuotaCard(title, q, type) {
    if (!q) return '';
    var hasUsage = type === 'rolling' && q.usage_percentage != null;
    var pct = q.usage_percentage || 0;
    var level = hasUsage ? pctLevel(pct) : 'none';

    var pctLabel = hasUsage ? fmtPct(pct) : '\u2014';
    var pctClass = hasUsage ? level : '';

    var barWidth = hasUsage ? Math.min(100, Math.max(0, pct * 100)) : 0;
    var barClass = hasUsage ? level : 'none';

    var flowLine = hasUsage
      ? fmtNum(q.used_flows) + ' / ' + fmtNum(q.max_flows) + ' Flows'
      : '上限 ' + fmtNum(q.max_flows) + ' Flows';

    var usdLine = hasUsage
      ? '\ud83d\udcb0 $' + fmtNum(q.used_value_usd) + ' / $' + fmtNum(q.max_value_usd)
      : '\ud83d\udcb0 上限 $' + fmtNum(q.max_value_usd);

    var remaining = hasUsage
      ? '<br><span>剩余 ' + fmtNum(q.remaining_flows) + ' Flows</span>'
      : '';

    var cdTarget = type === 'monthly' ? null : q.resets_at;
    var cd = cdTarget ? '<div class="quota-countdown">\u23f3 ' + countdownStr(cdTarget) + '</div>' : '';

    return '<div class="quota-card">'
      + '<div class="quota-card-header">'
        + '<span class="quota-card-title">' + title + '</span>'
        + '<span class="quota-card-pct ' + pctClass + '">' + pctLabel + '</span>'
      + '</div>'
      + '<div class="quota-bar-wrap"><div class="quota-bar-fill ' + barClass + '" style="width:' + barWidth + '%"></div></div>'
      + '<div class="quota-detail">' + flowLine + remaining + '<br>' + usdLine + '</div>'
      + cd
      + '</div>';
  }
};
