import fetch from 'node-fetch';

const BOT_TOKEN = process.env.BOT_TOKEN;

export async function sendTelegramMessage(chatId, text) {
  try {
    const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram API error:', data.description);
    }
    return data.ok;
  } catch (error) {
    console.error('Failed to send notification:', error);
    return false;
  }
}