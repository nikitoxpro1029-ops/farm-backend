import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { addQuestProgress } from '../services/quests.js';

const router = express.Router();

router.post('/open', verifyTelegramAuth, async (req, res) => {
  try {
    const { packId } = req.body;
    const user = await query('SELECT * FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = user.rows[0].id;

    const pack = await query('SELECT * FROM packs WHERE id = $1', [packId]);
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' });
    if (user.rows[0].balance < pack.rows[0].price) {
      return res.status(400).json({ error: 'Not enough balance' });
    }

    await query('UPDATE users SET balance = balance - $1 WHERE id = $2', [pack.rows[0].price, userId]);

    const contents = await query(
      `SELECT pc.*, st.name, st.rarity
       FROM pack_contents pc
       JOIN seed_types st ON pc.seed_type_id = st.id
       WHERE pc.pack_id = $1`,
      [packId]
    );

    const random = Math.random();
    let cumulative = 0;
    let selectedSeed = contents.rows[contents.rows.length - 1];

    for (const item of contents.rows) {
      cumulative += parseFloat(item.chance);
      if (random <= cumulative) { selectedSeed = item; break; }
    }

    await query(
      `INSERT INTO user_seeds (user_id, seed_type_id, quantity)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, seed_type_id)
       DO UPDATE SET quantity = user_seeds.quantity + 1`,
      [userId, selectedSeed.seed_type_id]
    );

    await addQuestProgress(userId, 'pack');
    res.json({ success: true, seed: { name: selectedSeed.name, rarity: selectedSeed.rarity } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;