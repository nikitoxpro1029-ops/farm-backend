import { query } from '../db.js';

const GROWTH_TIMES = {
  common: 5,
  uncommon: 10,
  rare: 15,
  epic: 60,
  legendary: 240,
  mythic: 720,
};

export async function plantSeed(userId, seedTypeId) {
  const seedResult = await query(
    'SELECT id FROM user_seeds WHERE user_id = $1 AND seed_type_id = $2 AND quantity > 0',
    [userId, seedTypeId]
  );
  if (seedResult.rows.length === 0) throw new Error('No seeds available');

  const typeResult = await query('SELECT * FROM seed_types WHERE id = $1', [seedTypeId]);
  const seedType = typeResult.rows[0];

  const growthMinutes = GROWTH_TIMES[seedType.rarity] || 5;
  const readyAt = new Date(Date.now() + growthMinutes * 60 * 1000);

  await query(
    'UPDATE user_seeds SET quantity = quantity - 1 WHERE user_id = $1 AND seed_type_id = $2',
    [userId, seedTypeId]
  );

  const result = await query(
    'INSERT INTO planted_crops (user_id, seed_type_id, ready_at) VALUES ($1, $2, $3) RETURNING *',
    [userId, seedTypeId, readyAt]
  );
  return result.rows[0];
}

export async function harvestCrop(userId, cropId) {
  const cropResult = await query(
    `SELECT pc.*, st.sell_price, st.name as seed_name, pc.seed_type_id
     FROM planted_crops pc
     JOIN seed_types st ON pc.seed_type_id = st.id
     WHERE pc.id = $1 AND pc.user_id = $2 AND pc.harvested = FALSE`,
    [cropId, userId]
  );
  if (cropResult.rows.length === 0) throw new Error('Crop not found');

  const crop = cropResult.rows[0];
  if (new Date(crop.ready_at) > new Date()) {
    const timeLeft = Math.ceil((new Date(crop.ready_at) - new Date()) / 1000 / 60);
    throw new Error(`Crop not ready. ${timeLeft} minutes left`);
  }

  await query('UPDATE planted_crops SET harvested = TRUE WHERE id = $1', [cropId]);

  await query(
    `INSERT INTO harvested_items (user_id, seed_type_id, quantity)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, seed_type_id)
     DO UPDATE SET quantity = harvested_items.quantity + 1`,
    [userId, crop.seed_type_id]
  );

  return { cropName: crop.seed_name, sellPrice: crop.sell_price };
}