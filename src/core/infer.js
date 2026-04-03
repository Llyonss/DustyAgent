const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    });
  }
  return client;
}

async function* infer(prompt, { signal } = {}) {
  const stream = await getClient().messages.create({
    model: process.env.LLM_MODEL,
    max_tokens: 8192,
    ...prompt,
    stream: true,
    signal,
  });

  let currentBlock = null;
  let inputJson = '';
  let textContent = '';
  let fullUsage = {};

  for await (const event of stream) {
    if (event.type === 'message_start') {
      // Capture input-side usage from message_start
      if (event.message && event.message.usage) {
        fullUsage = { ...event.message.usage };
      }
    } else if (event.type === 'content_block_start') {
      currentBlock = event.content_block;
      inputJson = '';
      textContent = '';
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        textContent += event.delta.text;
      } else if (event.delta.type === 'input_json_delta') {
        inputJson += event.delta.partial_json;
      }
    } else if (event.type === 'content_block_stop') {
      if (currentBlock && currentBlock.type === 'text' && textContent) {
        yield { type: 'text_block', text: textContent };
      } else if (currentBlock && currentBlock.type === 'tool_use') {
        yield {
          type: 'tool_call',
          id: currentBlock.id,
          name: currentBlock.name,
          input: inputJson ? JSON.parse(inputJson) : {},
        };
      }
      currentBlock = null;
    } else if (event.type === 'message_delta') {
      // Merge output-side usage from message_delta
      if (event.usage) {
        fullUsage = { ...fullUsage, ...event.usage };
      }
    }
  }

  // Yield merged usage at the end
  yield { type: 'usage', usage: fullUsage };
}

module.exports = { infer };
