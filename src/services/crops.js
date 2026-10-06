import { query } from '../db.js';
import { sendTelegramMessage } from './notifications.js';
import { addXp, XP_REWARDS } from './xp.js';
import { getPlotLevel, getLevelMultipliers } from './plots.js';
import { getPlotLevel, getLevelMultipliers } from './plots.js';

const GROWTH_TIMES = {
  common: 5,
  uncommon: 10,
  rare: 15,
  epic: 60,
  legendary: 240,
  mythic: 720,
};

export async function plantSeed(userId, seedTypeId, plotIndex = null) {
  const seedResult = await query(
    'SELECT id FROM user_seeds WHERE user_id = $1 AND seed_type_id = $2 AND quantity > 0',
    [userId, seedTypeId]
  );
  if (seedResult.rows.length === 0) throw new Error('No seeds available');

  const plotsInfo = await query('SELECT plots FROM users WHERE id = $1', [userId]);
  const maxPlots = plotsInfo.rows[0].plots;

  const plantedInfo = await query(
    'SELECT COUNT(*) as cnt FROM planted_crops WHERE user_id = $1 AND harvested = FALSE',
    [userId]
  );
  if (parseInt(plantedInfo.rows[0].cnt) >= maxPlots) {
    throw new Error('Все грядки заняты! Купите ещё в разделе Ферма.');
  }
  // Определяем, на какую грядку сажаем
  let finalPlotIndex = plotIndex;
  if (finalPlotIndex === null || finalPlotIndex === undefined) {
    // Если фронт не передал номер — ищем первую свободную
    const occupiedRes = await query(
      'SELECT plot_index FROM planted_crops WHERE user_id = $1 AND harvested = false',
      [userId]
    );
    const occupied = new Set(occupiedRes.rows.map(r => r.plot_index));
    for (let i = 0; i < maxPlots; i++) {
      if (!occupied.has(i)) { finalPlotIndex = i; break; }
    }
    if (finalPlotIndex === null) {
      throw new Error('Все грядки заняты! Купите ещё в разделе Ферма.');
    }
  }

  const typeResult = await query('SELECT * FROM seed_types WHERE id = $1', [seedTypeId]);
  const seedType = typeResult.rows[0];

  if (seedType.rarity === 'product') {
    throw new Error('Это блюдо нельзя посадить, только продать');
  }

  const plotLevel = await getPlotLevel(userId, finalPlotIndex);
  const { timeMultiplier } = getLevelMultipliers(plotLevel);
  const baseGrowthMinutes = GROWTH_TIMES[seedType.rarity] || 5;
  const growthMinutes = baseGrowthMinutes * timeMultiplier;
  const readyAt = new Date(Date.now() + growthMinutes * 60 * 1000);
  const expiresAt = new Date(readyAt.getTime() + 24 * 60 * 60 * 1000);

  await query(
    'UPDATE user_seeds SET quantity = quantity - 1 WHERE user_id = $1 AND seed_type_id = $2',
    [userId, seedTypeId]
  );

  await query(
    'INSERT INTO user_discovered (user_id, seed_type_id, times_collected) VALUES ($1, $2, 0) ON CONFLICT (user_id, seed_type_id) DO NOTHING',
    [userId, seedTypeId]
  );

  const result = await query(
  'INSERT INTO planted_crops (user_id, seed_type_id, ready_at, expires_at, water_level, last_watered, plot_index) VALUES ($1, $2, $3, $4, 100, NOW(), $5) RETURNING *',
  [userId, seedTypeId, readyAt, expiresAt, finalPlotIndex]
);

  const newCrop = result.rows[0];
  const delay = readyAt.getTime() - Date.now();

  if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
    setTimeout(async () => {
      try {
        const check = await query(
          'SELECT pc.id, pc.notified_ready, st.name as seed_name, u.telegram_id FROM planted_crops pc JOIN seed_types st ON pc.seed_type_id = st.id JOIN users u ON pc.user_id = u.id WHERE pc.id = $1 AND pc.harvested = FALSE AND pc.notified_ready = FALSE',
          [newCrop.id]
        );
        if (check.rows.length > 0) {
          const cropInfo = check.rows[0];
          const message = '🌾 Твой урожай готов!\n\n' +
                          'Растение: ' + cropInfo.seed_name + '\n' +
                          '⏰ Собери в течение 24 часов, иначе завянет!\n\n' +
                          'Открой Farm Game и забери его.';
          await sendTelegramMessage(cropInfo.telegram_id, message);
          await query('UPDATE planted_crops SET notified_ready = TRUE WHERE id = $1', [cropInfo.id]);
        }
      } catch (err) {
        console.error('Notification error:', err);
      }
    }, delay);
  }

  await addXp(userId, XP_REWARDS.plant, query);return newCrop;
}

export async function harvestCrop(userId, cropId) {
  const cropResult = await query(
  'SELECT pc.*, st.sell_price, st.rarity, st.name as seed_name, pc.seed_type_id FROM planted_crops pc JOIN seed_types st ON pc.seed_type_id = st.id WHERE pc.id = $1 AND pc.user_id = $2',
  [cropId, userId]
);
  if (cropResult.rows.length === 0) throw new Error('Crop not found');

  const crop = cropResult.rows[0];

  if (crop.expires_at && new Date(crop.expires_at) < new Date()) {
    await query('UPDATE planted_crops SET harvested = TRUE, withered = TRUE WHERE id = $1', [cropId]);
    throw new Error('Урожай завял. В следующий раз собирайте вовремя!');
  }

  if (new Date(crop.ready_at) > new Date()) {
    const timeLeft = Math.ceil((new Date(crop.ready_at) - new Date()) / 1000 / 60);
    throw new Error('Crop not ready. ' + timeLeft + ' minutes left');
  }

  await query('UPDATE planted_crops SET harvested = TRUE WHERE id = $1', [cropId]);

  await query('INSERT INTO harvested_items (user_id, seed_type_id, quantity) VALUES ($1, $2, 1) ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = harvested_items.quantity + 1',
    [userId, crop.seed_type_id]
  );

  await query(
    'INSERT INTO user_discovered (user_id, seed_type_id, times_collected) VALUES ($1, $2, 1) ON CONFLICT (user_id, seed_type_id) DO UPDATE SET times_collected = user_discovered.times_collected + 1',
    [userId, crop.seed_type_id]
  );

 await addXp(userId, XP_REWARDS.harvest, query);

  // 💎 Дроп кристаллов по редкости
  const CRYSTAL_CHANCE = {
    common: 0.01,
    uncommon: 0.03,
    rare: 0.05,
    epic: 0.10,
    legendary: 0.20,
    mythic: 0.40,
  };
  const chance = CRYSTAL_CHANCE[crop.rarity] || 0;
  const gotCrystal = Math.random() < chance;
  if (gotCrystal) {
    await query('UPDATE users SET crystals = crystals + 1 WHERE id = $1', [userId]);
  }
// 💰 Бонус дохода от уровня грядки
  const plotLevel = await getPlotLevel(userId, crop.plot_index);
  const { incomeMultiplier } = getLevelMultipliers(plotLevel);
  const incomeBonus = Math.round(crop.sell_price * (incomeMultiplier - 1));

  if (incomeBonus > 0) {
    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [incomeBonus, userId]);
  }
  return {
    cropName: crop.seed_name,
    sellPrice: crop.sell_price,
    crystal: gotCrystal ? 1 : 0,
    incomeBonus: incomeBonus,
    plotLevel: plotLevel,
  };
}

export async function waterCrop(userId, cropId) {
  const cropRes = await query(
    'SELECT * FROM planted_crops WHERE id = $1 AND user_id = $2 AND harvested = FALSE',
    [cropId, userId]
  );
  if (cropRes.rows.length === 0) throw new Error('Crop not found');

  await query(
    'UPDATE planted_crops SET water_level = 100, dry_since = NULL, last_watered = NOW() WHERE id = $1',
    [cropId]
  );

  return { success: true, waterLevel: 100 };
}