require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { readEvents, writeEvent } = require('../core/event');
const { loop } = require('../core/loop');
const { writeLog } = require('../core/log');

const instanceDir = path.join(__dirname, '../../instances/default');
const eventsDir = path.join(instanceDir, 'events');
const logDir = path.join(instanceDir, 'logs');
fs.mkdirSync(eventsDir, { recursive: true });

function displayEvent(e) {
  if (e.type === 'user') {
    console.log('\n\x1b[36m[You]\x1b[0m ' + e.content);
  } else if (e.type === 'action') {
    if (e.tool === 'speak') {
      console.log('\n\x1b[32m[Assistant]\x1b[0m ' + e.output);
    } else if (e.tool === 'stop' || e.tool === 'wait') {
      // silent
    } else {
      const inputStr = JSON.stringify(e.input);
      const outputStr = String(e.output);
      console.log('\n\x1b[33m[' + e.tool + ']\x1b[0m ' + inputStr + '\n  \u2192 ' + outputStr);
    }
  }
}

async function runLoop() {
  for await (const turn of loop({ instanceDir })) {
    writeLog(logDir, turn);
  }
}

async function main() {
  const existing = readEvents(eventsDir);
  for (const e of existing) {
    displayEvent(e);
  }

  let lastCount = existing.length;

  const watcher = setInterval(() => {
    const events = readEvents(eventsDir);
    if (events.length > lastCount) {
      for (let i = lastCount; i < events.length; i++) {
        displayEvent(events[i]);
      }
      lastCount = events.length;
    }
  }, 150);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('\n> ', async (input) => {
      if (!input.trim()) { prompt(); return; }
      if (input.trim() === '/quit') {
        clearInterval(watcher);
        rl.close();
        process.exit(0);
      }

      writeEvent(eventsDir, { type: 'user', content: input.trim() });
      await runLoop();
      prompt();
    });
  };

  console.log('\nDusty4 CLI - Type a message or /quit to exit');
  prompt();
}

main().catch(console.error);
