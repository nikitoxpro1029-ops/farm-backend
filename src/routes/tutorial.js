import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import {
  TUTORIAL_STEPS,
  ensureTutorial,
  getTutorialState,
  advanceStep,
  skipTutorial,
} from '../services/tutorial.js';

const router = express.Router();

// Получить текущее состояние туториала
router.get('/', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].id;

    await ensureTutorial(userId);
    const state = await getTutorialState(userId);

    const currentDialog = TUTORIAL_STEPS.find((s) => s.step === state.step);

    res.json({
      step: state.step,
      skipped: state.skipped,
      completed: state.completed,
      totalSteps: TUTORIAL_STEPS.length,
      dialog: currentDialog ? currentDialog.dialog : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Продвинуть шаг. Принимает ожидаемый текущий шаг, чтобы не сбиться.
router.post('/advance', verifyTelegramAuth, async (req, res) => {
  try {
    const { expectedStep } = req.body;
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].id;

    const advanced = await advanceStep(userId, Number(expectedStep));

    // Действия по завершении конкретных шагов:
    // Шаг 1 → выдать 3 морковки
    if (advanced && Number(expectedStep) === 1) {
      // seed_type_id морковки = 2 (по данным из БД)
      await query(
        `INSERT INTO user_seeds (user_id, seed_type_id, quantity) VALUES ($1, 2, 3)
         ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = user_seeds.quantity + 3`,
        [userId]
      );
    }
    // Шаг 10 → выдать 500 монет + завершить
    if (advanced && Number(expectedStep) === 10) {
      await query('UPDATE users SET balance = balance + 500 WHERE id = $1', [userId]);
    }

    const state = await getTutorialState(userId);
    const currentDialog = TUTORIAL_STEPS.find((s) => s.step === state.step);

    res.json({
      success: advanced,
      step: state.step,
      skipped: state.skipped,
      completed: state.completed,
      totalSteps: TUTORIAL_STEPS.length,
      dialog: currentDialog ? currentDialog.dialog : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Пропустить обучение (если пользователь нажал кнопку)
router.post('/skip', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].id;

    await skipTutorial(userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;