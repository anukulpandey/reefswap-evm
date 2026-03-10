#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sepIndex = line.indexOf('=');
    if (sepIndex === -1) continue;
    const key = line.slice(0, sepIndex).trim();
    if (!key || process.env[key]) continue;
    let value = line.slice(sepIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
};

parseEnvFile(ENV_FILE);

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
  console.error('telegram-prompt: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured.');
  process.exit(1);
}

const args = process.argv.slice(2);
let timeoutSeconds = 300;
const messageParts = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--timeout' && i + 1 < args.length) {
    const value = Number.parseInt(args[i + 1], 10);
    if (Number.isFinite(value) && value > 0) timeoutSeconds = value;
    i += 1;
    continue;
  }
  messageParts.push(arg);
}

const question = messageParts.join(' ').trim()
  || 'Human intervention required. Please choose Yes or No.';
const requestId = `codex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const yesData = `${requestId}:yes`;
const noData = `${requestId}:no`;
const startedAt = Date.now();
const apiBase = `https://api.telegram.org/bot${token}`;

const tgApi = async (method, params = {}) => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.set(key, String(value));
  }

  const response = await fetch(`${apiBase}/${method}`, {
    method: 'POST',
    body,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`telegram-prompt: ${method} failed (${payload.description || response.statusText})`);
  }
  return payload.result;
};

const getCurrentOffset = async () => {
  const updates = await tgApi('getUpdates', { timeout: 0, limit: 100 });
  if (!Array.isArray(updates) || updates.length === 0) return 0;
  return Math.max(...updates.map((u) => Number(u.update_id) || 0)) + 1;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const acceptDecision = async ({ choice, callbackQueryId, messageId }) => {
  if (callbackQueryId) {
    await tgApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: `Received: ${choice.toUpperCase()}`,
      show_alert: false,
    });
  }

  if (messageId) {
    try {
      await tgApi('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: JSON.stringify({ inline_keyboard: [] }),
      });
    } catch {
      // Do not fail the main flow if keyboard cleanup is rejected.
    }
  }
};

const run = async () => {
  let offset = await getCurrentOffset();
  const promptMessage = await tgApi('sendMessage', {
    chat_id: chatId,
    text: `🤖 ${question}`,
    disable_web_page_preview: true,
    reply_markup: JSON.stringify({
      inline_keyboard: [[
        { text: '✅ Yes', callback_data: yesData },
        { text: '❌ No', callback_data: noData },
      ]],
    }),
  });

  const promptMessageId = Number(promptMessage?.message_id) || 0;
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const updates = await tgApi('getUpdates', {
      timeout: 25,
      offset,
      allowed_updates: JSON.stringify(['callback_query', 'message']),
    });

    for (const update of updates) {
      offset = Math.max(offset, (Number(update.update_id) || 0) + 1);

      const callback = update.callback_query;
      if (callback?.data === yesData || callback?.data === noData) {
        const choice = callback.data.endsWith(':yes') ? 'yes' : 'no';
        await acceptDecision({
          choice,
          callbackQueryId: callback.id,
          messageId: Number(callback?.message?.message_id) || promptMessageId,
        });
        console.log(choice);
        process.exit(choice === 'yes' ? 0 : 2);
      }

      const message = update.message;
      const text = (message?.text || '').trim().toLowerCase();
      const replyToPrompt = Number(message?.reply_to_message?.message_id) === promptMessageId;
      const fromSameChat = String(message?.chat?.id || '') === String(chatId);
      const fresh = Number(message?.date || 0) * 1000 >= startedAt;
      if (replyToPrompt && fromSameChat && fresh && (text === 'yes' || text === 'no')) {
        await acceptDecision({
          choice: text,
          messageId: promptMessageId,
        });
        console.log(text);
        process.exit(text === 'yes' ? 0 : 2);
      }
    }

    await sleep(300);
  }

  console.log('timeout');
  process.exit(3);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
