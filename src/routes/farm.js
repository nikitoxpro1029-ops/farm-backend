import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { plantSeed, harvestCrop } from '../services/crops.js';
import { query } from '../db.js';

const router = express.Router();

router.get('/state', verifyTelegramAuth, async (req, res) => {
  try {
    let user = await query('SELECT * FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (user.rows.length === 0) {
      user = await query(
        'INSERT INTO users (telegram_id, username, first_name) VALUES ($1, $2, $3) RETURNING *',
        [req.telegramUser.id, req.telegramUser.username, req.telegramUser.first_name]
      );
    }

    const crops = await query(
      'SELECT pc.*, st.name, st.rarity FROM planted_crops pc JOIN seed_types st ON pc.seed_type_id = st.id WHERE pc.user_id = $1 AND pc.harvested = FALSE ORDER BY pc.planted_at DESC',
      [user.rows[0].id]
    );

    const seeds = await query(
      'SELECT us.*, st.name, st.rarity, st.id as seed_type_id FROM user_seeds us JOIN seed_types st ON us.seed_type_id = st.id WHERE us.user_id = $1 AND us.quantity > 0',
      [user.rows[0].id]
    );

    res.json({ user: user.rows[0], crops: crops.rows, seeds: seeds.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/plant', verifyTelegramAuth, async (req, res) => {
  try {
    const user = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const crop = await plantSeed(user.rows[0].id, req.body.seedTypeId);
    res.json({ success: true, crop });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/harvest', verifyTelegramAuth, async (req, res) => {
  try {
    const user = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const result = await harvestCrop(user.rows[0].id, req.body.cropId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/barn', verifyTelegramAuth, async (req, res) => {
  try {
    const user = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const items = await query(
      'SELECT hi.id, hi.quantity, st.name, st.rarity, st.sell_price, st.id as seed_type_id FROM harvested_items hi JOIN seed_types st ON hi.seed_type_id = st.id WHERE hi.user_id = $1 AND hi.quantity > 0 ORDER BY st.sell_price DESC',
      [user.rows[0].id]
    );
    res.json({ items: items.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sell', verifyTelegramAuth, async (req, res) => {
  try {
    const { seedTypeId, quantity } = req.body;
    const user = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = user.rows[0].id;

    const item = await query(
      'SELECT * FROM harvested_items WHERE user_id = $1 AND seed_type_id = $2',
      [userId, seedTypeId]
    );
    if (item.rows.length === 0 || item.rows[0].quantity < quantity) {
      return res.status(400).json({ error: 'Not enough items' });
    }

    const seed = await query('SELECT sell_price, name FROM seed_types WHERE id = $1', [seedTypeId]);
    const totalPrice = seed.rows[0].sell_price * quantity;

    await query(
      'UPDATE harvested_items SET quantity = quantity - $1 WHERE user_id = $2 AND seed_type_id = $3',
      [quantity, userId, seedTypeId]
    );

    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [totalPrice, userId]);

    res.json({ success: true, reward: totalPrice, itemName: seed.rows[0].name, quantity });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/bonus-status', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;
    const today = new Date().toISOString().slice(0, 10);const bonusRes = await query('SELECT * FROM daily_bonuses WHERE user_id = $1', [userId]);

    if (bonusRes.rows.length === 0) {
      return res.json({ streak: 0, canClaim: true, nextReward: 50, nextStreak: 1 });
    }

    const b = bonusRes.rows[0];
    const lastDate = b.last_claim_date.toISOString().slice(0, 10);
    const canClaim = lastDate !== today;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    let nextStreak;
    if (lastDate === today) {
      nextStreak = b.streak;
    } else if (lastDate === yesterday) {
      nextStreak = b.streak >= 7 ? 1 : b.streak + 1;
    } else {
      nextStreak = 1;
    }

    const rewards = [0, 50, 75, 100, 150, 200, 300, 500];
    const nextReward = rewards[nextStreak] || 50;

    res.json({ streak: b.streak, canClaim, nextReward, nextStreak });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/claim-bonus', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const bonusRes = await query('SELECT * FROM daily_bonuses WHERE user_id = $1', [userId]);

    let newStreak;
    if (bonusRes.rows.length === 0) {
      newStreak = 1;
    } else {
      const b = bonusRes.rows[0];
      const lastDate = b.last_claim_date.toISOString().slice(0, 10);

      if (lastDate === today) {
        return res.status(400).json({ error: 'Already claimed today' });
      }

      if (lastDate === yesterday) {
        newStreak = b.streak >= 7 ? 1 : b.streak + 1;
      } else {
        newStreak = 1;
      }
    }

    const rewards = [0, 50, 75, 100, 150, 200, 300, 500];
    const reward = rewards[newStreak] || 50;

    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [reward, userId]);

    let bonusSeed = null;
    if (newStreak === 7) {
      const seedRes = await query(
        'SELECT id, name, rarity FROM seed_types WHERE rarity = $1 ORDER BY RANDOM() LIMIT 1',
        ['rare']
      );
      if (seedRes.rows.length > 0) {
        const seed = seedRes.rows[0];
        await query(
          'INSERT INTO user_seeds (user_id, seed_type_id, quantity) VALUES ($1, $2, 1) ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = user_seeds.quantity + 1',
          [userId, seed.id]
        );
        bonusSeed = { name: seed.name, rarity: seed.rarity };
      }
    }

    if (bonusRes.rows.length === 0) {
      await query(
        'INSERT INTO daily_bonuses (user_id, last_claim_date, streak, total_claims) VALUES ($1, $2, $3, 1)',
        [userId, today, newStreak]
      );
    } else {
      await query(
        'UPDATE daily_bonuses SET last_claim_date = $1, streak = $2, total_claims = total_claims + 1 WHERE user_id = $3',
        [today, newStreak, userId]
      );
    }

    res.json({ success: true, reward, streak: newStreak, bonusSeed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;