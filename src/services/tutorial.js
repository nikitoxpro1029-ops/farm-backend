import { query } from '../db.js';

// Тексты шагов. Используются на фронте, но дублируем на бэке для валидации.
export const TUTORIAL_STEPS = [
  // 1 — вводный диалог
  { step: 1, dialog: 'Здравствуй, внучок! Я — дед Мазай. Стар я стал, хозяйство моё в упадок пришло… Прими ферму, а я подскажу, что к чему. Держи-ка 3 морковки — посадим?' },
  { step: 2, dialog: 'Вот твоя грядка. Тапни по ней — посадишь морковку.' },
  { step: 3, dialog: 'Молодец! Теперь полей её — видишь капельку? Без воды никак.' },
  { step: 4, dialog: 'Терпение, внучок — морковь не сразу растёт. Если спешишь — ускорить можно. А теперь жди.' },
  { step: 5, dialog: 'Гляди-ка, созрела! Жми «Собрать» — и урожай в Амбаре.' },
  { step: 6, dialog: 'Деньги нужны всегда. Открой Амбар сверху → вкладку Урожай → продай морковку.' },
  { step: 7, dialog: 'Умница! А теперь расширяйся — купи ещё грядку. Больше грядок — больше монет!' },
  { step: 8, dialog: 'Слышал, в Паках диковинные семена выпадают? Попробуй открыть один — авось повезёт!' },
  { step: 9, dialog: 'А вот моё любимое — Кухня! Приготовь блюдо — прибыль жирнее в разы.' },
  { step: 10, dialog: 'И последнее — Задания. Каждый день там новые, забрать награду не забудь. Держи 500💰 на первое хозяйство. Я горжусь тобой, внучок!' },
];

// Создать запись туториала для нового игрока (если нет).
export async function ensureTutorial(userId) {
  await query(
    'INSERT INTO user_tutorial (user_id, step) VALUES ($1, 1) ON CONFLICT (user_id) DO NOTHING',
    [userId]
  );
}

// Получить состояние туториала.
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

// Продвинуть шаг вперёд, если текущий совпадает с expectedStep.
// Возвращает true, если удалось продвинуться.
export async function advanceStep(userId, expectedStep) {
  const state = await getTutorialState(userId);
  if (state.skipped || state.completed) return false;
  if (state.step !== expectedStep) return false;

  const nextStep = expectedStep + 1;

  if (nextStep > TUTORIAL_STEPS.length) {
    // Туториал завершён
    await query(
      'UPDATE user_tutorial SET step = $1, completed_at = NOW() WHERE user_id = $2',
      [nextStep, userId]
    );
  } else {
    await query(
      'UPDATE user_tutorial SET step = $1 WHERE user_id = $2',
      [nextStep, userId]
    );
  }
  return true;
}

// Пропустить обучение.
export async function skipTutorial(userId) {
  await query(
    'UPDATE user_tutorial SET skipped = true, step = 11, completed_at = NOW() WHERE user_id = $1',
    [userId]
  );
}