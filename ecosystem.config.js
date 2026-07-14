/**
 * PM2 配置 — 只保活 Guardian
 *
 * 架构：
 *   PM2 (OS 级保活，永不挂)
 *     └── guardian.js   ← 纯代理 + SSH 隧道 + mental 看门狗
 *            └── mental  ← guardian 自己 spawn + 健康检查 + 自动重启
 *
 * 用法：
 *   pm2 start ecosystem.config.js
 *   pm2 save            # 保存进程列表
 *   pm2 startup         # 生成开机自启（按提示执行）
 *   pm2 logs guardian   # 看日志
 *   pm2 restart guardian
 */

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'guardian',
      script: path.resolve(__dirname, 'src/guardian.js'),
      cwd: __dirname,

      // 保活策略
      autorestart: true,
      max_restarts: 50,          // 崩溃重启上限（避免死循环烧 CPU）
      min_uptime: '10s',         // 活过 10s 才算启动成功
      restart_delay: 3000,       // 崩溃后延迟 3s 再拉起
      exp_backoff_restart_delay: 200, // 频繁崩溃时指数退避

      // 关键：注入环境变量，改变 guardian.js 行为（零改源码）
      env: {
        // 跳过 self-detach —— 否则 guardian 会 fork 自己再退出，
        // PM2 判定崩溃又拉起，形成死循环
        GUARDIAN_DETACHED: '1',
        // 打开 mental 自动重启 —— mental 挂了 guardian 自动拉它
        GUARDIAN_AUTO_RESTART: 'true',
      },

      // 日志（崩溃留痕，不再石沉大海）
      out_file: path.resolve(__dirname, 'logs/guardian-out.log'),
      error_file: path.resolve(__dirname, 'logs/guardian-err.log'),
      merge_logs: true,
      time: true,                // 每行加时间戳
    },
  ],
};
