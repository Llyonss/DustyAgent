require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { readEvents, writeEvent } = require('../core/event');
const { loop } = require('../core/loop');
const createDefaultAgent = require('../agent/default');
const createDocAgent = require('../agent/doc');

const instanceName = process.argv[2] || 'default';
const instanceDir = path.join(__dirname, '../../instances', instanceName);
const eventsDir = path.join(instanceDir, 'events');
fs.mkdirSync(eventsDir, { recursive: true });

function createAgent(instanceDir) {
  if (fs.existsSync(path.join(instanceDir, 'doc.md'))) {
    return createDocAgent(instanceDir);
  }
  return createDefaultAgent(instanceDir);
}

const hooks = createAgent(instanceDir);

function displayEvent(e) {
  if (e.type === 'user') {
    console.log('\n\x1b[36m[You]\x1b[0m ' + e.content);
  } else if (e.type === 'error') {
    console.log('\n\x1b[31m[Error]\x1b[0m ' + e.message);
  } else if (e.type === 'action') {
    if (e.tool === 'speak') {
      console.log('\n\x1b[32m[Assistant]\x1b[0m ' + e.output);
    } else if (e.tool === 'apply') {
      const summary = e.input && e.input.summary || '';
      console.log('\n\x1b[33m[📄 Document Updated]\x1b[0m ' + summary);
    } else if (e.tool === 'stop' || e.tool === 'wait') {
      // silent
    } else {
      const inputStr = JSON.stringify(e.input);
      const outputStr = String(e.output);
      console.log('\n\x1b[33m[' + e.tool + ']\x1b[0m ' + inputStr + '\n  → ' + outputStr);
    }
  }
}

async function runLoop() {
  for await (const turn of loop({ instanceDir, hooks })) {
  }
}

async function main() {
  const isDoc = fs.existsSync(path.join(instanceDir, 'doc.md'));
  console.log('\nDusty4 CLI — instance: ' + instanceName + ' [' + (isDoc ? 'doc' : 'agent') + ']');
  console.log('Type a message or /quit to exit\n');

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

  prompt();
}

main().catch(console.error);
