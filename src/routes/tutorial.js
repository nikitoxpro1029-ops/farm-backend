import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import {
  TUTORIAL_STEPS,
  ensureTutorial,
  getTutorialState,
  advanceStepManual,
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
    const currentStep = TUTORIAL_STEPS.find((s) => s.step === state.step);

    res.json({
      step: state.step,
      skipped: state.skipped,
      completed: state.completed,
      totalSteps: TUTORIAL_STEPS.length,
      dialog: currentStep ? currentStep.dialog : null,
      mode: currentStep && currentStep.trigger ? 'action' : 'manual',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ручное продвижение (кнопка "Дальше")
router.post('/advance', verifyTelegramAuth, async (req, res) => {
  try {
    const { expectedStep } = req.body;
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].id;

    const advanced = await advanceStepManual(userId, Number(expectedStep));
    const state = await getTutorialState(userId);
    const currentStep = TUTORIAL_STEPS.find((s) => s.step === state.step);

    res.json({
      success: advanced,
      step: state.step,
      skipped: state.skipped,
      completed: state.completed,
      totalSteps: TUTORIAL_STEPS.length,
      dialog: currentStep ? currentStep.dialog : null,
      mode: currentStep && currentStep.trigger ? 'action' : 'manual',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Пропустить обучение
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