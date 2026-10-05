import { query } from '../db.js';

// trigger: null = manual (кнопка "Дальше")
// trigger: 'xxx' = auto (ждём событие от бэка)
export const TUTORIAL_STEPS = [
  { step: 1,  dialog: 'Здравствуй, внучок! Я — дед Мазай. Стар я стал, хозяйство моё в упадок пришло… Прими ферму, а я подскажу, что к чему. Держи-ка морковку — посадим?', trigger: null },
  { step: 2,  dialog: 'Вот твоя грядка. Тапни по ней — посадишь морковку.', trigger: 'plant' },
  { step: 3,  dialog: 'Молодец! Теперь полей её — видишь капельку? Без воды никак.', trigger: 'water' },
  { step: 4,  dialog: 'Терпение, внучок — морковь не сразу растёт. Если спешишь — ускорь удобрением. А теперь жди.', trigger: null },
  { step: 5,  dialog: 'Гляди-ка, созрела! Жми «Собрать» — и урожай в Амбар.', trigger: 'harvest' },
  { step: 6,  dialog: 'Деньги нужны всегда. Открой Амбар сверху → вкладку Урожай → продай одну морковку.', trigger: 'sell' },
  { step: 7,  dialog: 'Умница! Держи новую грядку в подарок от Деда — расширяйся, внучок!', trigger: null },
  { step: 8,  dialog: 'Слышал, в Паках диковинные семена выпадают? Попробуй открыть один — авось повезёт!', trigger: 'pack' },
  { step: 9,  dialog: 'А вот моё любимое — Кухня! Держи 3 морковки — испеки Морковный пирог, прибыль жирнее в разы.', trigger: 'cook' },
  { step: 10, dialog: 'И последнее — Задания. Заходи туда каждый день, забирай награды. Держи 500💰 на первое хозяйство. Я горжусь тобой, внучок!', trigger: 'quests' },
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

  // Шаг 4 → 5: мгновенно ускоряем последнюю грядку, чтобы морковь созрела
  if (nextStep === 5) {
    await query(
      `UPDATE planted_crops
       SET ready_at = NOW()
       WHERE id = (
         SELECT id FROM planted_crops
         WHERE user_id = $1 AND harvested = false AND withered = falseORDER BY id DESC LIMIT 1
       )`,
      [userId]
    );
  }

  // Шаг 5 → 6: даём +3 морковки в амбар, чтобы было что продать
  if (nextStep === 6) {
    await query(
      `INSERT INTO harvested_items (user_id, seed_type_id, quantity) VALUES ($1, 2, 3)
       ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = harvested_items.quantity + 3`,
      [userId]
    );
  }

  // Шаг 6 → 7: дарим +1 грядку
  if (nextStep === 7) {
    await query('UPDATE users SET plots = plots + 1 WHERE id = $1', [userId]);
  }

  // Шаг 8 → 9: даём +3 морковки в амбар для Морковного пирога
  if (nextStep === 9) {
    await query(
      `INSERT INTO harvested_items (user_id, seed_type_id, quantity) VALUES ($1, 2, 3)
       ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = harvested_items.quantity + 3`,
      [userId]
    );
  }

  // Завершение туториала
  if (nextStep > TUTORIAL_STEPS.length) {
    await query(
      'UPDATE user_tutorial SET step = $1, completed_at = NOW() WHERE user_id = $2',
      [nextStep, userId]
    );
    // Награда за прохождение — 500 монет
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
    'UPDATE user_tutorial SET skipped = true, step = 11, completed_at = NOW() WHERE user_id = $1',
    [userId]
  );
}