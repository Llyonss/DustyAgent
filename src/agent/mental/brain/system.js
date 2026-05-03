const os = require('os');
const fs = require('fs');
const path = require('path');

const baseEnv = `Environment: ${os.platform()}/${os.arch()}, shell: ${os.platform() === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/sh'}, cwd: ${process.cwd()}`;

function tryRead(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

module.exports = function createSystem(instanceDir) {
  const instName = path.basename(instanceDir);
  const ENV = `${baseEnv}\nInstance: ${instName}, instanceDir: ${instanceDir}`;
  return () => {
    const content = tryRead(path.join(instanceDir, 'system.md')) || '';
    return [{ type: 'text', text: content.trimEnd() + '\n\n' + ENV, cache_control: { type: 'ephemeral', ttl: '1h' } }];
  };
};
