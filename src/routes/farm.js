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
      `SELECT pc.*, st.name, st.rarity
       FROM planted_crops pc
       JOIN seed_types st ON pc.seed_type_id = st.id
       WHERE pc.user_id = $1 AND pc.harvested = FALSE
       ORDER BY pc.planted_at DESC`,
      [user.rows[0].id]
    );

    const seeds = await query(
      `SELECT us.*, st.name, st.rarity, st.id as seed_type_id
       FROM user_seeds us
       JOIN seed_types st ON us.seed_type_id = st.id
       WHERE us.user_id = $1 AND us.quantity > 0`,
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

export default router;// Получить содержимое амбара
router.get('/barn', verifyTelegramAuth, async (req, res) => {
  try {
    const user = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const items = await query(
      `SELECT hi.id, hi.quantity, st.name, st.rarity, st.sell_price, st.id as seed_type_id
       FROM harvested_items hi
       JOIN seed_types st ON hi.seed_type_id = st.id
       WHERE hi.user_id = $1 AND hi.quantity > 0
       ORDER BY st.sell_price DESC`,
      [user.rows[0].id]
    );
    res.json({ items: items.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Продать культуру из амбара
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

    res.json({
      success: true,
      reward: totalPrice,
      itemName: seed.rows[0].name,
      quantity,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});