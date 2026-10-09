import { query } from '../db.js';

// Каталог
export async function getCatalog() {
  const res = await query(
    'SELECT id, name, type, rarity, icon, price_crystals, max_supply, current_supply FROM cosmetics ORDER BY type, price_crystals'
  );
  return res.rows;
}

// Инвентарь игрока + что надето
export async function getMyCosmetics(userId) {
  const owned = await query(
    `SELECT uc.id AS user_cosmetic_id, uc.cosmetic_id, uc.serial_number, uc.acquired_at,
       c.name, c.type, c.rarity, c.icon, c.bg_image, c.bg_image_sq, c.bg_image_wide, c.price_crystals
     FROM user_cosmetics uc
     JOIN cosmetics c ON c.id = uc.cosmetic_id
     WHERE uc.user_id = $1
     ORDER BY uc.acquired_at DESC`,
    [userId]
  );

  const loadoutRes = await query(
    'SELECT equipped_avatar, equipped_frame, equipped_title FROM user_loadout WHERE user_id = $1',
    [userId]
  );
  const lo = loadoutRes.rows[0] || {};

  return {
    items: owned.rows,
    equipped: {
      avatar: lo.equipped_avatar || null,
      frame: lo.equipped_frame || null,
      title: lo.equipped_title || null,
    },
  };
}

// Купить
export async function buyCosmetic(userId, cosmeticId) {
  const c = await query('SELECT * FROM cosmetics WHERE id = $1', [cosmeticId]);
  if (c.rows.length === 0) return { error: 'NOT_FOUND' };
  const item = c.rows[0];

  const have = await query(
    'SELECT 1 FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = $2',
    [userId, cosmeticId]
  );
  if (have.rows.length > 0) return { error: 'ALREADY_OWNED' };

  if (item.max_supply > 0 && item.current_supply >= item.max_supply) {
    return { error: 'SOLD_OUT' };
  }

  const u = await query('SELECT crystals FROM users WHERE id = $1', [userId]);
  if (u.rows.length === 0) return { error: 'USER_NOT_FOUND' };
  if (u.rows[0].crystals < item.price_crystals) return { error: 'NOT_ENOUGH_CRYSTALS' };

  await query('UPDATE users SET crystals = crystals - $1 WHERE id = $2', [item.price_crystals, userId]);

  let serial = null;
  if (item.max_supply > 0) {
    serial = item.current_supply + 1;
    await query('UPDATE cosmetics SET current_supply = current_supply + 1 WHERE id = $1', [cosmeticId]);
  }

  await query(
    'INSERT INTO user_cosmetics (user_id, cosmetic_id, serial_number) VALUES ($1, $2, $3)',
    [userId, cosmeticId, serial]
  );

  return { success: true, name: item.name, serial };
}

// Надеть
export async function equipCosmetic(userId, cosmeticId) {
  const own = await query(
    `SELECT c.type FROM user_cosmetics uc
     JOIN cosmetics c ON c.id = uc.cosmetic_id
     WHERE uc.user_id = $1 AND uc.cosmetic_id = $2`,
    [userId, cosmeticId]
  );
  if (own.rows.length === 0) return { error: 'NOT_OWNED' };
  const type = own.rows[0].type;

  const fields = { avatar: 'equipped_avatar', frame: 'equipped_frame', title: 'equipped_title' };
  const field = fields[type];
  if (!field) return { error: 'UNKNOWN_TYPE' };

  await query(
    `INSERT INTO user_loadout (user_id, ${field}) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET ${field} = $2`,
    [userId, cosmeticId]
  );

  return { success: true, type };
}

// Снять
export async function unequipType(userId, type) {
  const fields = { avatar: 'equipped_avatar', frame: 'equipped_frame', title: 'equipped_title' };
  const field = fields[type];
  if (!field) return { error: 'UNKNOWN_TYPE' };

  await query(`UPDATE user_loadout SET ${field} = NULL WHERE user_id = $1`, [userId]);
  return { success: true };
}

// Публичный профиль (для лидерборда)
export async function getPublicLoadout(userId) {
  const res = await query(
    `SELECT ca.icon AS avatar_icon, cf.icon AS frame_icon, ct.icon AS title_icon
     FROM user_loadout ul
     LEFT JOIN cosmetics ca ON ca.id = ul.equipped_avatar
     LEFT JOIN cosmetics cf ON cf.id = ul.equipped_frame
     LEFT JOIN cosmetics ct ON ct.id = ul.equipped_title
     WHERE ul.user_id = $1`,
    [userId]
  );
  return res.rows[0] || {};
}