const os = require('os');

const ENV_INFO = `\nEnvironment: ${os.platform()}/${os.arch()}, shell: ${os.platform() === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/sh'}, cwd: ${process.cwd()}`;

const SYSTEM = 'You are a ReAct agent. You accomplish tasks by using tools.' + ENV_INFO;

module.exports = () => [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];
