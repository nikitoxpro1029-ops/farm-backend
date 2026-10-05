import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import farmRoutes from './routes/farm.js';
import packRoutes from './routes/packs.js';
import craftRoutes from './routes/craft.js';
import { query } from './db.js';
import { sendTelegramMessage } from './services/notifications.js';
import petsRoutes from './routes/pets.js';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/farm', farmRoutes);
app.use('/api/packs', packRoutes);
app.use('/api/craft', craftRoutes);app.use('/api/pets', petsRoutes);

app.get('/', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));

// При старте — догоняем пропущенные уведомления о созревании
setTimeout(async () => {
  try {
    const ready = await query(
      'SELECT pc.id, st.name as seed_name, u.telegram_id FROM planted_crops pc JOIN seed_types st ON pc.seed_type_id = st.id JOIN users u ON pc.user_id = u.id WHERE pc.harvested = FALSE AND pc.notified_ready = FALSE AND pc.ready_at <= NOW()'
    );
    for (const crop of ready.rows) {
      const message = '🌾 Пока тебя не было — урожай созрел!\n\n' +
                      'Растение: ' + crop.seed_name + '\n' +
                      '⏰ Собери в течение 24 часов!';
      await sendTelegramMessage(crop.telegram_id, message);
      await query('UPDATE planted_crops SET notified_ready = TRUE WHERE id = $1', [crop.id]);
    }
    console.log('Startup notification check done:', ready.rows.length, 'notifications sent');
  } catch (error) {
    console.error('Startup notification error:', error);
  }
}, 5000);

// Реактивация неактивных игроков (24+ часов без игры)
async function checkInactivePlayers() {
  try {
    const inactive = await query(
      "SELECT telegram_id, first_name FROM users WHERE last_seen < NOW() - INTERVAL '24 hours' AND inactive_notified = FALSE"
    );
    for (const user of inactive.rows) {
      const name = user.first_name || 'Фермер';
      const message = '🌾 ' + name + ', твоя ферма скучает!\n\n' +
                      'Пока тебя не было, урожай мог созреть или завянуть. ' +
                      'Заходи посадить новые семена и собрать монеты!';
      await sendTelegramMessage(user.telegram_id, message);
      await query('UPDATE users SET inactive_notified = TRUE WHERE telegram_id = $1', [user.telegram_id]);
    }
    console.log('Inactive players check:', inactive.rows.length, 'notifications sent');
  } catch (error) {
    console.error('Inactive check error:', error);
  }
}async function checkBonusReminders() {
  try {
    const candidates = await query(
      "SELECT u.telegram_id, u.first_name FROM users u LEFT JOIN daily_bonuses db ON db.user_id = u.id WHERE (db.last_claim_date IS NULL OR db.last_claim_date < CURRENT_DATE) AND (u.bonus_notified_date IS NULL OR u.bonus_notified_date < CURRENT_DATE) LIMIT 50"
    );
    for (const user of candidates.rows) {
      const name = user.first_name || 'Фермер';
      const message = '🎁 ' + name + ', твой ежедневный бонус ждёт!\n\nЗаходи и забери монеты — на 7-й день дают 1000💰 и редкое семя!';
      await sendTelegramMessage(user.telegram_id, message);
      await query('UPDATE users SET bonus_notified_date = CURRENT_DATE WHERE telegram_id = $1', [user.telegram_id]);
    }
    console.log('Bonus reminders:', candidates.rows.length, 'sent');
  } catch (error) {
    console.error('Bonus reminder error:', error);
  }
}

setTimeout(checkBonusReminders, 20000);
setInterval(checkBonusReminders, 6 * 60 * 60 * 1000);

setTimeout(checkInactivePlayers, 15000);
setInterval(checkInactivePlayers, 60 * 60 * 1000);