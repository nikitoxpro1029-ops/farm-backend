import crypto from 'crypto';

export const verifyTelegramAuth = (req, res, next) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'No init data' });

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return res.status(403).json({ error: 'Invalid auth' });
    }

    const authDate = parseInt(params.get('auth_date'));
    if (Date.now() / 1000 - authDate > 3600) {
      return res.status(403).json({ error: 'Auth expired' });
    }

    req.telegramUser = JSON.parse(params.get('user'));
    next();
  } catch (error) {
    res.status(500).json({ error: 'Auth error' });
  }
};