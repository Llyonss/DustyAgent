// === 轻量截屏服务 ===
// Windows 下通过 PowerShell 脚本截屏，零额外依赖
// 带缓存机制，避免频繁调用

const { exec } = require('child_process');
const path = require('path');

let lastScreenshot = null;
let lastUpdated = 0;
const CACHE_TTL = 1500; // 1.5s 缓存

// 使用外部 PS1 脚本文件，避免内联命令的引号转义问题
const PS_SCRIPT = path.join(__dirname, 'screenshot.ps1');  // 同目录

async function capture() {
  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${PS_SCRIPT}"`,
      { timeout: 10000, maxBuffer: 50 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(err);
        if (stderr && stderr.trim()) console.error('[screenshot] stderr:', stderr.trim().slice(0, 200));
        const b64 = (stdout || '').trim();
        if (!b64) return reject(new Error('empty screenshot output'));
        resolve(b64);
      }
    );
  });
}

/**
 * 获取屏幕截图（base64 JPEG string）
 */
async function getScreenshot() {
  const now = Date.now();
  if (lastScreenshot && now - lastUpdated < CACHE_TTL) {
    return lastScreenshot;
  }
  try {
    lastScreenshot = await capture();
    lastUpdated = now;
    return lastScreenshot;
  } catch (e) {
    console.error('[screenshot] capture failed:', e.message);
    return lastScreenshot; // 降级：返回旧截图
  }
}

module.exports = { getScreenshot };
