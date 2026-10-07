import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import {
  getCatalog, getMyCosmetics, buyCosmetic, equipCosmetic, unequipType,
} from '../services/cosmetics.js';

const router = express.Router();

router.get('/catalog', verifyTelegramAuth, async (req, res) => {
  try {
    const catalog = await getCatalog();
    res.json({ catalog });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/my', verifyTelegramAuth, async (req, res) => {
  try {
    const u = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const data = await getMyCosmetics(u.rows[0].id);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/buy/:id', verifyTelegramAuth, async (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const u = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const r = await buyCosmetic(u.rows[0].id, cid);
    if (r.error) {
      const msgs = {
        NOT_FOUND: 'Предмет не найден',
        ALREADY_OWNED: 'Уже есть',
        SOLD_OUT: 'Лимит исчерпан',
        USER_NOT_FOUND: 'Игрок не найден',
        NOT_ENOUGH_CRYSTALS: 'Не хватает кристаллов',
      };
      return res.status(400).json({ error: msgs[r.error] || 'Ошибка' });
    }
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/equip/:id', verifyTelegramAuth, async (req, res) => {
  try {
    const cid = parseInt(req.params.id, 10);
    const u = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const r = await equipCosmetic(u.rows[0].id, cid);
    if (r.error) return res.status(400).json({ error: r.error === 'NOT_OWNED' ? 'Нет в инвентаре' : 'Ошибка' });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/unequip/:type', verifyTelegramAuth, async (req, res) => {
  try {
    const u = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const r = await unequipType(u.rows[0].id, req.params.type);
    if (r.error) return res.status(400).json({ error: 'Ошибка' });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;