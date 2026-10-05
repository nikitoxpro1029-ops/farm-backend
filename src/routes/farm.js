import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { plantSeed, harvestCrop, waterCrop } from '../services/crops.js';
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

    await query('UPDATE users SET last_seen = NOW(), inactive_notified = FALSE WHERE id = $1', [user.rows[0].id]);

    await query(
      'UPDATE planted_crops SET harvested = TRUE, withered = TRUE WHERE user_id = $1 AND harvested = FALSE AND expires_at IS NOT NULL AND expires_at < NOW()',
      [user.rows[0].id]
    );

    const awRes = await query('SELECT autowater_until FROM users WHERE id = $1', [user.rows[0].id]);
    const awUntil = awRes.rows[0].autowater_until;
    const hasAutowater = awUntil && new Date(awUntil) > new Date();

    if (hasAutowater) {
      await query(
        'UPDATE planted_crops SET water_level = 100, last_watered = NOW() WHERE user_id = $1 AND harvested = FALSE',
        [user.rows[0].id]
      );
    } else {
      await query(
        'UPDATE planted_crops SET water_level = GREATEST(0, water_level - FLOOR(EXTRACT(EPOCH FROM (NOW() - last_watered)) / 3600 * 10)), last_watered = NOW() WHERE user_id = $1 AND harvested = FALSE AND water_level > 0',
        [user.rows[0].id]
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

    res.json({
      user: user.rows[0],
      crops: crops.rows,
      seeds: seeds.rows,
      autowater: {
        active: hasAutowater,
        until: awUntil,
      },
    });
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

router.post('/water', verifyTelegramAuth, async (req, res) => {
  try {
    const { cropId, score } = req.body;
    const user = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const result = await waterCrop(user.rows[0].id, cropId, score);
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
    res.json({ items: items.rows });} catch (error) {
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
    const avgQualityRes = await query(
      'SELECT AVG(quality) as avg_q FROM planted_crops WHERE user_id = $1 AND seed_type_id = $2 AND harvested = TRUE',
      [userId, seedTypeId]
    );
    const avgQuality = parseFloat(avgQualityRes.rows[0]?.avg_q || 50);
    const qualityMultiplier = 0.5 + (avgQuality / 100);
    const unitPrice = Math.floor(seed.rows[0].sell_price * qualityMultiplier);
    const totalPrice = unitPrice * quantity;

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

router.get('/leaderboard', verifyTelegramAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT telegram_id, username, first_name, balance FROM users ORDER BY balance DESC LIMIT 50'
    );
    res.json({ leaderboard: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/plots', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id, plots FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const user = userRes.rows[0];
    const maxAllowed = 12;
    const canBuy = user.plots < maxAllowed;
    const prices = [0, 0, 0, 0, 0, 0, 500, 1000, 2000, 4000, 8000, 16000, 0];
    const nextPrice = canBuy ? prices[user.plots + 1] : 0;

    const plantedInfo = await query(
      'SELECT COUNT(*) as cnt FROM planted_crops WHERE user_id = $1 AND harvested = FALSE',
      [user.id]
    );

    res.json({
      plots: user.plots,
      maxAllowed,
      canBuy,
      nextPrice,
      planted: parseInt(plantedInfo.rows[0].cnt),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/buy-plot', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id, plots, balance FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const user = userRes.rows[0];
    const maxAllowed = 12;

    if (user.plots >= maxAllowed) {
      return res.status(400).json({ error: 'Максимум грядок достигнут' });
    }

    const prices = [0, 0, 0, 0, 0, 0, 500, 1000, 2000, 4000, 8000, 16000, 0];
    const price = prices[user.plots + 1];

    if (user.balance < price) {
      return res.status(400).json({ error: 'Недостаточно монет' });
    }

    await query('UPDATE users SET balance = balance - $1, plots = plots + 1 WHERE id = $2', [price, user.id]);

    res.json({ success: true, newPlots: user.plots + 1, spent: price });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/fertilize', verifyTelegramAuth, async (req, res) => {
  try {
    const { cropId } = req.body;
    const userRes = await query('SELECT id, balance FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const user = userRes.rows[0];

    const cropRes = await query(
      'SELECT * FROM planted_crops WHERE id = $1 AND user_id = $2 AND harvested = FALSE AND fertilized = FALSE',
      [cropId, user.id]
    );
    if (cropRes.rows.length === 0) {return res.status(400).json({ error: 'Эту грядку уже удобряли или не нашли' });
    }

    const cost = 100;
    if (user.balance < cost) {
      return res.status(400).json({ error: 'Недостаточно монет (нужно 100)' });
    }

    const crop = cropRes.rows[0];
    const now = new Date();
    const readyAt = new Date(crop.ready_at);
    const plantedAt = new Date(crop.planted_at);
    const totalTime = readyAt.getTime() - plantedAt.getTime();
    const elapsed = now.getTime() - plantedAt.getTime();
    const remaining = totalTime - elapsed;

    const newRemaining = Math.max(1000, remaining / 2);
    const newReadyAt = new Date(now.getTime() + newRemaining);

    await query('UPDATE users SET balance = balance - $1 WHERE id = $2', [cost, user.id]);
    await query(
      'UPDATE planted_crops SET ready_at = $1, fertilized = TRUE WHERE id = $2',
      [newReadyAt, cropId]
    );

    res.json({ success: true, spent: cost, savedMs: remaining - newRemaining });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/buy-autowater', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id, balance, autowater_until FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const user = userRes.rows[0];
    const cost = 500;

    if (user.balance < cost) {
      return res.status(400).json({ error: 'Недостаточно монет (нужно 500)' });
    }

    const now = new Date();
    const currentUntil = user.autowater_until && new Date(user.autowater_until) > now
      ? new Date(user.autowater_until)
      : now;
    const newUntil = new Date(currentUntil.getTime() + 24 * 60 * 60 * 1000);

    await query('UPDATE users SET balance = balance - $1, autowater_until = $2 WHERE id = $3', [cost, newUntil, user.id]);

    res.json({ success: true, until: newUntil, spent: cost });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/bonus-status', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;
    const today = new Date().toISOString().slice(0, 10);

    const bonusRes = await query('SELECT * FROM daily_bonuses WHERE user_id = $1', [userId]);

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
    }const rewards = [0, 50, 75, 100, 150, 200, 300, 500];
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

export default router;router.post('/set-referrer', verifyTelegramAuth, async (req, res) => {
  try {
    const { referrerTelegramId } = req.body;
    if (!referrerTelegramId) return res.json({ success: false, message: 'No referrer' });

    const userRes = await query('SELECT id, referrer_id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const user = userRes.rows[0];

    if (user.referrer_id) {
      return res.json({ success: false, message: 'Already has referrer' });
    }

    if (String(referrerTelegramId) === String(req.telegramUser.id)) {
      return res.json({ success: false, message: 'Cannot refer yourself' });
    }

    const referrerRes = await query('SELECT id FROM users WHERE telegram_id = $1', [referrerTelegramId]);
    if (referrerRes.rows.length === 0) {
      return res.json({ success: false, message: 'Referrer not found' });
    }

    await query('UPDATE users SET referrer_id = $1 WHERE id = $2', [referrerTelegramId, user.id]);
    await query('UPDATE users SET balance = balance + 500, referrals_count = referrals_count + 1 WHERE telegram_id = $1', [referrerTelegramId]);
    await query('UPDATE users SET balance = balance + 200 WHERE id = $1', [user.id]);

    res.json({ success: true, reward: 200, referrerReward: 500 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/referral-info', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query(
      'SELECT referrals_count, referrer_id FROM users WHERE telegram_id = $1',
      [req.telegramUser.id]
    );
    const user = userRes.rows[0];
    res.json({
      referralsCount: user.referrals_count || 0,
      hasReferrer: !!user.referrer_id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});