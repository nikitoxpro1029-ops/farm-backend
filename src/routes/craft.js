import express from 'express';
import { verifyTelegramAuth } from '../middleware/auth.js';
import { query } from '../db.js';

const router = express.Router();

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
    const { recipeId } = req.body;
    const userRes = await query('SELECT id FROM users WHERE telegram_id = $1', [req.telegramUser.id]);
    const userId = userRes.rows[0].id;

    const recipe = await query('SELECT * FROM recipes WHERE id = $1', [recipeId]);
    if (recipe.rows.length === 0) return res.status(404).json({ error: 'Recipe not found' });

    const ingredients = await query(
      'SELECT seed_type_id, quantity FROM recipe_ingredients WHERE recipe_id = $1',
      [recipeId]
    );

    for (const ing of ingredients.rows) {
      const have = await query(
        'SELECT quantity FROM harvested_items WHERE user_id = $1 AND seed_type_id = $2',
        [userId, ing.seed_type_id]
      );
      if (have.rows.length === 0 || have.rows[0].quantity < ing.quantity) {
        return res.status(400).json({ error: 'Not enough ingredients' });
      }
    }

    for (const ing of ingredients.rows) {
      await query(
        'UPDATE harvested_items SET quantity = quantity - $1 WHERE user_id = $2 AND seed_type_id = $3',
        [ing.quantity, userId, ing.seed_type_id]
      );
    }

    const resultSeedId = recipe.rows[0].result_seed_type_id;

    await query(
      'INSERT INTO harvested_items (user_id, seed_type_id, quantity) VALUES ($1, $2, 1) ON CONFLICT (user_id, seed_type_id) DO UPDATE SET quantity = harvested_items.quantity + 1',
      [userId, resultSeedId]
    );

    const resultInfo = await query('SELECT name, rarity FROM seed_types WHERE id = $1', [resultSeedId]);

    res.json({
      success: true,
      resultName: resultInfo.rows[0].name,
      resultRarity: resultInfo.rows[0].rarity,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;