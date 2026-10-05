import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';

const router = express.Router();

const PET_CONFIG = {
  cat: { name: '🐱 Кот', price: 2000, income: 50, maxHours: 10, single: true },
  dog: { name: '🐶 Собака', price: 3000, income: 0, maxHours: 0, single: true },
  chicken: { name: '🐔 Курица', price: 1500, income: 0, maxHours: 0, single: false, interval: 2, productPrice: 100, productName: 'Яйцо' },
  cow: { name: '🐮 Корова', price: 4000, income: 0, maxHours: 0, single: false, interval: 3, productPrice: 200, productName: 'Молоко' },
};

router.get('/', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;

    const pets = await query(
      'SELECT * FROM user_pets WHERE user_id = $1 ORDER BY adopted_at DESC',
      [userId]
    );

    const result = pets.rows.map((pet) => {
      const config = PET_CONFIG[pet.pet_type] || {};
      let pendingIncome = 0;
      let canCollect = false;
      const hoursSince = Math.floor((Date.now() - new Date(pet.last_collect).getTime()) / 3600000);
      const qty = pet.quantity || 1;

      if (pet.pet_type === 'cat') {
        const effectiveHours = Math.min(hoursSince, config.maxHours);
        pendingIncome = effectiveHours * config.income;
        canCollect = pendingIncome > 0;
      }

      if (pet.pet_type === 'chicken' || pet.pet_type === 'cow') {
        const intervals = Math.floor(hoursSince / config.interval);
        const itemsCount = intervals * qty;
        pendingIncome = itemsCount * config.productPrice;
        canCollect = itemsCount > 0;
      }

      return {
        id: pet.id,
        type: pet.pet_type,
        name: config.name,
        quantity: qty,
        pendingIncome,
        canCollect,
        hoursSince,
        productName: config.productName,
      };
    });

    // Каталог показывает только тех, кого можно купить
    const ownedTypes = pets.rows.map((p) => p.pet_type);
    const catalog = Object.entries(PET_CONFIG)
      .filter(([key, val]) => {
        if (val.single && ownedTypes.includes(key)) return false;
        return true;
      })
      .map(([key, val]) => ({ type: key, ...val }));

    res.json({ pets: result, catalog });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/buy', verifyTelegramAuth, async (req, res) => {
  try {
    const { petType } = req.body;
    const config = PET_CONFIG[petType];
    if (!config) return res.status(400).json({ error: 'Invalid pet type' });

    const userRes = await query('SELECT id, balance FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const user = userRes.rows[0];

    if (config.single) {
      const existing = await query(
        'SELECT id FROM user_pets WHERE user_id = $1 AND pet_type = $2',
        [user.id, petType]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Этот питомец уже есть' });
      }
    }

    if (user.balance < config.price) {
      return res.status(400).json({ error: 'Недостаточно монет' });
    }

    await query('UPDATE users SET balance = balance - $1 WHERE id = $2', [config.price, user.id]);

    if (config.single) {
      await query('INSERT INTO user_pets (user_id, pet_type, quantity) VALUES ($1, $2, 1)', [user.id, petType]);
    } else {
      const existing = await query(
        'SELECT id FROM user_pets WHERE user_id = $1 AND pet_type = $2',
        [user.id, petType]
      );
      if (existing.rows.length > 0) {
        await query('UPDATE user_pets SET quantity = quantity + 1 WHERE id = $1', [existing.rows[0].id]);
      } else {
        await query('INSERT INTO user_pets (user_id, pet_type, quantity) VALUES ($1, $2, 1)', [user.id, petType]);
      }
    }

    res.json({ success: true, petType, spent: config.price });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/collect', verifyTelegramAuth, async (req, res) => {
  try {
    const { petId } = req.body;
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;

    const petRes = await query('SELECT * FROM user_pets WHERE id = $1 AND user_id = $2', [petId, userId]);
    if (petRes.rows.length === 0) return res.status(404).json({ error: 'Pet not found' });

    const pet = petRes.rows[0];
    const config = PET_CONFIG[pet.pet_type];
    const hoursSince = Math.floor((Date.now() - new Date(pet.last_collect).getTime()) / 3600000);
    const qty = pet.quantity || 1;

    if (pet.pet_type === 'cat') {
      const effectiveHours = Math.min(hoursSince, config.maxHours);
      const income = effectiveHours * config.income;
      if (income <= 0) return res.status(400).json({ error: 'Пока нечего забирать' });
      await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [income, userId]);
      await query('UPDATE user_pets SET last_collect = NOW() WHERE id = $1', [petId]);
      return res.json({ success: true, reward: income, type: 'coins' });
    }

    if (pet.pet_type === 'chicken' || pet.pet_type === 'cow') {
      const intervals = Math.floor(hoursSince / config.interval);
      const itemsCount = intervals * qty;
      if (itemsCount <= 0) return res.status(400).json({ error: 'Пока нечего забирать' });
      const productType = await query('SELECT id FROM seed_types WHERE name = $1', [config.productName]);
      if (productType.rows.length === 0) return res.status(500).json({ error: 'Product type not found' });
      await query(
        'INSERT INTO harvested_items (user_id, seed_type_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = harvested_items.quantity + $3',
        [userId, productType.rows[0].id, itemsCount]
      );
      await query('UPDATE user_pets SET last_collect = NOW() WHERE id = $1', [petId]);
      return res.json({ success: true, reward: itemsCount, type: 'product', productName: config.productName });
    }

    res.status(400).json({ error: 'Cannot collect from this pet' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;