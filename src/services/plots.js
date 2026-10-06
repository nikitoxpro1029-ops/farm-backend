import { query } from '../db.js';

// Получить уровень прокачки грядки (по умолчанию 1)
export async function getPlotLevel(userId, plotIndex) {
  const res = await query(
    'SELECT level FROM plot_upgrades WHERE user_id = $1 AND plot_index = $2',
    [userId, plotIndex]
  );
  return res.rows.length > 0 ? res.rows[0].level : 1;
}

// Получить уровни всех грядок игрока — Map { plotIndex: level }
export async function getAllPlotLevels(userId) {
  const res = await query(
    'SELECT plot_index, level FROM plot_upgrades WHERE user_id = $1',
    [userId]
  );
  const map = {};
  for (const row of res.rows) {
    map[row.plot_index] = row.level;
  }
  return map;
}

// Множители бонусов на основе уровня
export function getLevelMultipliers(level) {
  // Уровень 1 — базовая. Каждый следующий: −1.5% времени, +2% дохода.
  const lvl = Math.max(1, Math.min(30, level));
  const steps = lvl - 1;
  return {
    timeMultiplier: Math.max(0.55, 1 - steps * 0.015),  // минимум 0.55 (на 30 уровне)
    incomeMultiplier: 1 + steps * 0.02,                  // до 1.6 на 30 уровне
  };
}

// Стоимость следующего апгрейда (для перехода с текущего уровня на текущий+1)
export function getUpgradeCost(currentLevel) {
  // Стоимость шага по уровням:
  // 1-5: 200-500, 6-10: 700-1200, 11-15: 1500-2500,
  // 16-20: 3000-4500, 21-25: 5000-7000, 26-30: 8000-12000
  const next = currentLevel + 1;
  if (next > 30) return null; // max

  const tiers = [
    { start: 2,  prices: [200, 250, 350, 400, 500] },       // → уровень 2..6
    { start: 7,  prices: [700, 800, 900, 1000, 1200] },     // → 7..11
    { start: 12, prices: [1500, 1700, 1900, 2200, 2500] },  // → 12..16
    { start: 17, prices: [3000, 3300, 3600, 4000, 4500] },  // → 17..21
    { start: 22, prices: [5000, 5500, 6000, 6500, 7000] },  // → 22..26
    { start: 27, prices: [8000, 9000, 10000, 11000, 12000] }, // → 27..31 (но 31 — это уже 30+1)
  ];

  for (const tier of tiers) {
    if (next >= tier.start && next < tier.start + 5) {
      const idx = next - tier.start;
      return { coins: tier.prices[idx], crystals: 0 };
    }
  }
  return null;
}

// Стоимость кристаллов для перехода (только на "красивых" уровнях 5/10/15/20/25/30)
export function getCrystalCostForLevel(newLevel) {
  const crystalLevels = {
    5: 5,
    10: 10,
    15: 20,
    20: 35,
    25: 50,
    30: 80,
  };
  return crystalLevels[newLevel] || 0;
}

// Прокачать грядку. Возвращает { success, newLevel, cost } или ошибку.
export async function upgradePlot(userId, plotIndex) {
  const currentLevel = await getPlotLevel(userId, plotIndex);
  if (currentLevel >= 30) return { error: 'MAX_LEVEL' };

  const cost = getUpgradeCost(currentLevel);
  if (!cost) return { error: 'MAX_LEVEL' };

  const newLevel = currentLevel + 1;
  const crystalsNeeded = getCrystalCostForLevel(newLevel);

  // Проверяем баланс
  const userRes = await query('SELECT balance, crystals FROM users WHERE id = $1', [userId]);
  if (userRes.rows.length === 0) return { error: 'USER_NOT_FOUND' };
  const user = userRes.rows[0];

  if (user.balance < cost.coins) return { error: 'NOT_ENOUGH_COINS' };
  if (user.crystals < crystalsNeeded) return { error: 'NOT_ENOUGH_CRYSTALS' };

  // Списываем
  await query(
    'UPDATE users SET balance = balance - $1, crystals = crystals - $2 WHERE id = $3',
    [cost.coins, crystalsNeeded, userId]
  );

  // Обновляем уровень
  await query(
    `INSERT INTO plot_upgrades (user_id, plot_index, level) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, plot_index) DO UPDATE SET level = $3`,
    [userId, plotIndex, newLevel]
  );

  return { success: true, newLevel, cost: cost.coins, crystals: crystalsNeeded };
}