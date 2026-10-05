import { query } from '../db.js';

// Пул заданий. Каждый день игрок получает 3 случайных.
// Награды подобраны так, чтобы за день выходило ~120-180💰
export const QUEST_POOL = [
  { type: 'plant',   target: 5,  reward: 30, xp: 15, label: '🌱 Посади 5 семян' },
  { type: 'harvest', target: 8,  reward: 50, xp: 15, label: '🌾 Собери 8 урожая' },
  { type: 'sell',    target: 6,  reward: 40, xp: 15, label: '💰 Продай 6 урожая' },
  { type: 'water',   target: 10, reward: 30, xp: 15, label: '💧 Полей 10 раз' },
  { type: 'cook',    target: 2,  reward: 60, xp: 15, label: '🍳 Приготовь 2 блюда' },
  { type: 'pack',    target: 1,  reward: 40, xp: 15, label: '🎁 Открой 1 пак' },
];

// Убедиться, что у игрока есть задания на сегодня.
// Если нет — генерируем 3 случайных.
export async function ensureTodayQuests(userId) {
  const existing = await query(
    'SELECT id FROM user_quests WHERE user_id = $1 AND quest_date = CURRENT_DATE LIMIT 1',
    [userId]
  );
  if (existing.rows.length > 0) return;

  const shuffled = [...QUEST_POOL].sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, 3);

  for (const q of chosen) {
    await query(
      `INSERT INTO user_quests (user_id, quest_type, target, reward, xp_reward, quest_date)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)`,
      [userId, q.type, q.target, q.reward, q.xp]
    );
  }
}

// Увеличить прогресс задания нужного типа (если оно есть у игрока на сегодня).
// Вызывается из farm.js / craft.js / packs.js при соответствующих действиях.
export async function addQuestProgress(userId, questType, amount = 1) {
  try {
    await query(
      `UPDATE user_quests
       SET progress = LEAST(progress + $1, target)
       WHERE user_id = $2
         AND quest_date = CURRENT_DATE
         AND quest_type = $3
         AND claimed = false`,
      [amount, userId, questType]
    );
  } catch (error) {
    // Не ломаем основное действие, если что-то пошло не так с заданиями
    console.error('addQuestProgress error:', error.message);
  }
}