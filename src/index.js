import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import farmRoutes from './routes/farm.js';
import packRoutes from './routes/packs.js';import craftRoutes from './routes/craft.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/farm', farmRoutes);
app.use('/api/packs', packRoutes);app.use('/api/craft', craftRoutes);

app.get('/', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));// Проверка просроченных уведомлений при старте
import { query } from './db.js';
import { sendTelegramMessage } from './services/notifications.js';

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