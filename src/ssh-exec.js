const { Client } = require('ssh2');

const HOST = process.env.SSH_HOST || 'localhost';
const USER = process.env.SSH_USER || 'root';
const PASS = process.env.SSH_PASS || '';
const PORT = parseInt(process.env.SSH_PORT || '22', 10);

const cmd = process.argv[2] || 'uname -a';

// 加载 .env
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const conn = new Client();
conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    let out = '';
    stream.on('data', d => { out += d; process.stdout.write(d); });
    stream.stderr.on('data', d => { process.stderr.write(d); });
    stream.on('close', () => { conn.end(); });
  });
}).on('error', e => { console.error('SSH Error:', e.message); })
  .connect({ host: process.env.SSH_HOST, port: 22, username: process.env.SSH_USER, password: process.env.SSH_PASS });
