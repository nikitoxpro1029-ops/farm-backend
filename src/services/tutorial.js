import { query } from '../db.js';

// trigger: null = manual (кнопка "Дальше")
// trigger: 'xxx' = auto (ждём событие от бэка)
export const TUTORIAL_STEPS = [
  { step: 1, dialog: 'Привет, друг! Я — Дракоша, маленький дракончик! 🐉 Увидел твою ферму и сразу захотел подружиться! Держи морковку — давай посадим вместе?', trigger: null },
  { step: 2, dialog: 'Ура-а! Видишь пустую грядку? Тапни по ней — и посадишь морковку! Я уже чую, как она вкусно пахнет! 🌱', trigger: 'plant' },
  { step: 3, dialog: 'Огонёк! 🌊 Друг, полей её — видишь капельку на грядке? Дракончики тоже любят водичку!', trigger: 'water' },
  { step: 4, dialog: 'Смотри-смотри! Созрела! 🥕 Жми «Собрать» — и урожай полетит в Амбар!', trigger: 'harvest' },
  { step: 5, dialog: 'А теперь продадим! Открой Амбар → вкладку Урожай → продай одну морковку. Звонкие монетки — ммм! 💰', trigger: 'sell' },
  { step: 6, dialog: 'Ты справился! Держи новую грядку в подарок — от меня, Дракоши! Расти-расти, друг! 🎁', trigger: null },
  { step: 7, dialog: 'Слушай, а в Паках есть диковинные семечки! Попробуй открыть один — вдруг там что-то огненное? 🔥', trigger: 'pack' },
  { step: 8, dialog: 'А теперь самое вкусное — Кухня! 🍳 Держи 3 морковки, испеки Морковный пирог! Драконы обожают пироги!', trigger: 'cook' },
  { step: 9, dialog: 'И напоследок — Задания! 📋 Заходи каждый день, забирай награды. Держи 500 монет на первое хозяйство! Я горжусь тобой, друг! 🎉', trigger: 'quests' },
];

export async function ensureTutorial(userId) {
  await query(
    'INSERT INTO user_tutorial (user_id, step) VALUES ($1, 1) ON CONFLICT (user_id) DO NOTHING',
    [userId]
  );
}

export async function getTutorialState(userId) {
  await ensureTutorial(userId);
  const res = await query(
    'SELECT step, skipped, completed_at FROM user_tutorial WHERE user_id = $1',
    [userId]
  );
  if (res.rows.length === 0) return { step: 1, skipped: false, completed: false };
  const row = res.rows[0];
  return {
    step: row.step,
    skipped: row.skipped,
    completed: !!row.completed_at,
  };
}

// Ручное продвижение (кнопка "Дальше"). Только для шагов без trigger.
export async function advanceStepManual(userId, expectedStep) {
  const state = await getTutorialState(userId);
  if (state.skipped || state.completed) return false;
  if (state.step !== expectedStep) return false;

  const currentStep = TUTORIAL_STEPS.find(s => s.step === expectedStep);
  if (currentStep && currentStep.trigger) return false;

  return advanceTo(userId, expectedStep + 1);
}

// Автоматическое продвижение (по триггеру от события в игре)
export async function tryAdvanceByTrigger(userId, trigger) {
  try {
    const state = await getTutorialState(userId);
    if (state.skipped || state.completed) return false;

    const currentStep = TUTORIAL_STEPS.find(s => s.step === state.step);
    if (!currentStep || currentStep.trigger !== trigger) return false;

    return advanceTo(userId, state.step + 1);
  } catch (e) {
    console.error('tryAdvanceByTrigger error:', e.message);
    return false;
  }
}

async function advanceTo(userId, nextStep) {
  // Шаг 1 → 2: даём 1 морковку (семечко) для посадки
  if (nextStep === 2) {
    await query(
      `INSERT INTO user_seeds (user_id, seed_type_id, quantity) VALUES ($1, 2, 1)
       ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = user_seeds.quantity + 1`,
      [userId]
    );
  }

  // Шаг 2 → 3: сбрасываем воду последней грядки до 30%, чтобы была кнопка «Полить»
  if (nextStep === 3) {
    await query(
      `UPDATE planted_crops
       SET water_level = 30, last_watered = NULL
       WHERE id = (
         SELECT id FROM planted_crops
         WHERE user_id = $1 AND harvested = false AND withered = false
         ORDER BY id DESC LIMIT 1
       )`,
      [userId]
    );
  }

  // Шаг 3 → 4: мгновенно ускоряем морковь (после полива она «сразу созрела»)
  if (nextStep === 4) {
    await query(
      `UPDATE planted_crops
       SET ready_at = NOW()
       WHERE id = (
         SELECT id FROM planted_crops
         WHERE user_id = $1 AND harvested = false AND withered = false
         ORDER BY id DESC LIMIT 1
       )`,
      [userId]
    );
  }

  

  // Шаг 5 → 6: дарим +1 грядку
  if (nextStep === 6) {
    await query('UPDATE users SET plots = plots + 1 WHERE id = $1', [userId]);
  }

 // Перешли на шаг 8 ("Кухня") — додаём морковки до 3
    if (nextStep === 8) {
      const cur = await query(
        'SELECT quantity FROM harvested_items WHERE user_id = $1 AND seed_type_id = 2',
        [userId]
      );
      const have = cur.rows.length > 0 ? cur.rows[0].quantity : 0;
      if (have < 3) {
        const diff = 3 - have;
        await query(
          `INSERT INTO harvested_items (user_id, seed_type_id, quantity) VALUES ($1, 2, $2)
           ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = harvested_items.quantity + $2`,
          [userId, diff]
        );
      }
    }

  // Завершение туториала
  if (nextStep > TUTORIAL_STEPS.length) {
    await query(
      'UPDATE user_tutorial SET step = $1, completed_at = NOW() WHERE user_id = $2',
      [nextStep, userId]
    );
    await query('UPDATE users SET balance = balance + 500 WHERE id = $1', [userId]);
  } else {
    await query(
      'UPDATE user_tutorial SET step = $1 WHERE user_id = $2',
      [nextStep, userId]
    );
  }
  return true;
}

export async function skipTutorial(userId) {
  await query(
    'UPDATE user_tutorial SET skipped = true, step = 10, completed_at = NOW() WHERE user_id = $1',
    [userId]
  );
}