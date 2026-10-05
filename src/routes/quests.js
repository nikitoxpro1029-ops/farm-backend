import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { ensureTodayQuests, QUEST_POOL } from '../services/quests.js';
import { tryAdvanceByTrigger } from '../services/tutorial.js';

const router = express.Router();

// Список заданий на сегодня + авто-генерация при первом заходе
router.get('/', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [req.telegramUser.id]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].id;

    // Если сегодня ещё нет заданий — сгенерируем
    await ensureTodayQuests(userId);
    await tryAdvanceByTrigger(userId, 'quests');

    const result = await query(
      `SELECT id, quest_type, target, progress, reward, xp_reward, claimed
       FROM user_quests
       WHERE user_id = $1 AND quest_date = CURRENT_DATE
       ORDER BY claimed ASC, id ASC`,
      [userId]
    );

    const quests = result.rows.map((row) => {
      const meta = QUEST_POOL.find((q) => q.type === row.quest_type);
      return {
        id: row.id,
        type: row.quest_type,
        label: meta ? meta.label : row.quest_type,
        target: row.target,
        progress: row.progress,
        reward: row.reward,
        xpReward: row.xp_reward,
        claimed: row.claimed,
        completed: row.progress >= row.target,
      };
    });

    const unclaimedReady = quests.filter((q) => q.completed && !q.claimed).length;

    res.json({
      quests,
      unclaimedReady, // для красного бейджа в шапке
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Забрать награду
router.post('/claim/:id', verifyTelegramAuth, async (req, res) => {
  try {
    const questId = parseInt(req.params.id, 10);
    const userRes = await query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [req.telegramUser.id]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].id;

    const qRes = await query(
      `SELECT id, target, progress, reward, xp_reward, claimed
       FROM user_quests
       WHERE id = $1 AND user_id = $2 AND quest_date = CURRENT_DATE`,
      [questId, userId]
    );
    if (qRes.rows.length === 0) return res.status(404).json({ error: 'Quest not found' });

    const q = qRes.rows[0];
    if (q.claimed) return res.status(400).json({ error: 'Уже забрано' });
    if (q.progress < q.target) return res.status(400).json({ error: 'Задание ещё не выполнено' });

    // Начисляем монеты
    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [q.reward, userId]);
    // Помечаем задание забранным
    await query('UPDATE user_quests SET claimed = true WHERE id = $1', [questId]);

    res.json({
      success: true,
      reward: q.reward,
      xpReward: q.xp_reward,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;