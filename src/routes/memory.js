import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';

const router = express.Router();

const COOLDOWN_HOURS = 4;

router.get('/status', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;
    const result = await query('SELECT * FROM memory_cooldowns WHERE user_id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.json({ canPlay: true, nextPlayIn: 0 });
    }

    const last = new Date(result.rows[0].last_played).getTime();
    const diff = Date.now() - last;
    const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;

    if (diff >= cooldownMs) {
      return res.json({ canPlay: true, nextPlayIn: 0 });
    }
    res.json({ canPlay: false, nextPlayIn: cooldownMs - diff });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/finish', verifyTelegramAuth, async (req, res) => {
  try {
    const { moves } = req.body;
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;

    const check = await query('SELECT * FROM memory_cooldowns WHERE user_id = $1', [userId]);
    if (check.rows.length > 0) {
      const last = new Date(check.rows[0].last_played).getTime();
      if (Date.now() - last < COOLDOWN_HOURS * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Игра ещё не готова' });
      }
    }

    const safeMoves = Math.max(8, Math.min(40, parseInt(moves) || 40));
    let reward = 150 - (safeMoves - 8) * 8;
    if (reward < 20) reward = 20;

    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [reward, userId]);

    let bonusSeed = null;
    if (safeMoves <= 10) {
      const seedRes = await query(
        "SELECT id, name FROM seed_types WHERE rarity = 'rare' ORDER BY RANDOM() LIMIT 1"
      );
      if (seedRes.rows.length > 0) {
        const seed = seedRes.rows[0];
        await query(
          "INSERT INTO user_seeds (user_id, seed_type_id, quantity) VALUES ($1, $2, 1) ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = user_seeds.quantity + 1",
          [userId, seed.id]
        );
        bonusSeed = seed.name;
      }
    }

    if (check.rows.length === 0) {
      await query('INSERT INTO memory_cooldowns (user_id, last_played) VALUES ($1, NOW())', [userId]);
    } else {
      await query('UPDATE memory_cooldowns SET last_played = NOW() WHERE user_id = $1', [userId]);
    }

    res.json({ success: true, reward, bonusSeed, moves: safeMoves });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;