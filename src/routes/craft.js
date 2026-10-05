import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { addQuestProgress } from '../services/quests.js';

const router = express.Router();

// Допустимые множители от мини-игры Кухни
const VALID_MULTIPLIERS = [0.5, 1.0, 1.15, 1.3];

router.get('/recipes', verifyTelegramAuth, async (req, res) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;

    const recipes = await query(
      'SELECT r.id, r.name, st.name as result_name, st.rarity as result_rarity, st.sell_price as result_price FROM recipes r JOIN seed_types st ON st.id = r.result_seed_type_id ORDER BY st.sell_price ASC'
    );

    const barn = await query(
      'SELECT seed_type_id, quantity FROM harvested_items WHERE user_id = $1',
      [userId]
    );
    const barnMap = {};
    for (const row of barn.rows) {
      barnMap[row.seed_type_id] = row.quantity;
    }

    const result = [];
    for (const recipe of recipes.rows) {
      const ingredients = await query(
        'SELECT st.name, st.id as seed_type_id, ri.quantity FROM recipe_ingredients ri JOIN seed_types st ON st.id = ri.seed_type_id WHERE ri.recipe_id = $1',
        [recipe.id]
      );

      const ingredientList = ingredients.rows.map((ing) => ({
        name: ing.name,
        seedTypeId: ing.seed_type_id,
        needed: ing.quantity,
        have: barnMap[ing.seed_type_id] || 0,
        enough: (barnMap[ing.seed_type_id] || 0) >= ing.quantity,
      }));

      const canCraft = ingredientList.every((ing) => ing.enough);

      result.push({
        id: recipe.id,
        name: recipe.name,
        resultName: recipe.result_name,
        resultRarity: recipe.result_rarity,
        resultPrice: recipe.result_price,
        ingredients: ingredientList,
        canCraft,
      });
    }

    res.json({ recipes: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/craft', verifyTelegramAuth, async (req, res) => {
  try {
    const { recipeId, multiplier } = req.body;

    // Множитель из мини-игры: 0.5 / 1.0 / 1.5 / 2.0
    // Если не передан (старый клиент) — 1.0 (без бонуса)
    const mult = VALID_MULTIPLIERS.includes(Number(multiplier)) ? Number(multiplier) : 1.0;

    const userRes = await query('SELECT id, balance FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = userRes.rows[0].id;

    const recipe = await query('SELECT * FROM recipes WHERE id = $1', [recipeId]);
    if (recipe.rows.length === 0) return res.status(404).json({ error: 'Recipe not found' });

    const ingredients = await query(
      'SELECT seed_type_id, quantity FROM recipe_ingredients WHERE recipe_id = $1',
      [recipeId]
    );

    // Проверяем, что у игрока хватает ингредиентов
    for (const ing of ingredients.rows) {
      const have = await query(
        'SELECT quantity FROM harvested_items WHERE user_id = $1 AND seed_type_id = $2',
        [userId, ing.seed_type_id]
      );
      if (have.rows.length === 0 || have.rows[0].quantity < ing.quantity) {
        return res.status(400).json({ error: 'Not enough ingredients' });
      }
    }

    // Списываем ингредиенты
    for (const ing of ingredients.rows) {
      await query(
        'UPDATE harvested_items SET quantity = quantity - $1 WHERE user_id = $2 AND seed_type_id = $3',
        [ing.quantity, userId, ing.seed_type_id]
      );
    }

    const resultSeedId = recipe.rows[0].result_seed_type_id;

    // Кладём блюдо в амбар
    await query(
      'INSERT INTO harvested_items (user_id, seed_type_id, quantity) VALUES ($1, $2, 1) ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = harvested_items.quantity + 1',
      [userId, resultSeedId]
    );

    const resultInfo = await query('SELECT name, rarity, sell_price FROM seed_types WHERE id = $1', [resultSeedId]);
    const basePrice = resultInfo.rows[0].sell_price;

    // Бонус за точность. mult=0.5 или 1.0 → bonus=0
    // mult=1.5 → +50% от basePrice; mult=2.0 → +100% от basePrice
    let bonus = 0;
    if (mult > 1.0) {
      bonus = Math.round(basePrice * (mult - 1.0));
    }

    let newBalance = userRes.rows[0].balance;
    if (bonus > 0) {
      const upd = await query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
        [bonus, userId]
      );
      newBalance = upd.rows[0].balance;
    }

    await addQuestProgress(userId, 'cook');res.json({
      success: true,
      resultName: resultInfo.rows[0].name,
      resultRarity: resultInfo.rows[0].rarity,
      basePrice,
      multiplier: mult,
      bonus,
      newBalance,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;