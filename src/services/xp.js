export const XP_REWARDS = {
  plant: 5,
  harvest: 20,
  water: 2,
  sell_item: 2,
  buy_plot: 50,
  cook: 30,
  memory_win: 25,
};

export function xpForLevel(level) {
  return 100 + (level - 1) * 50;
}

export async function addXp(userId, amount, queryFn) {
  const userRes = await queryFn('SELECT xp, level FROM users WHERE id = $1', [userId]);
  if (userRes.rows.length === 0) return null;

  let xp = userRes.rows[0].xp || 0;
  let level = userRes.rows[0].level || 1;
  const oldLevel = level;

  xp += amount;

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }

  await queryFn('UPDATE users SET xp = $1, level = $2 WHERE id = $3', [xp, level, userId]);

  return {
    xp,
    level,
    leveledUp: level > oldLevel,
    xpForNext: xpForLevel(level),
  };
}