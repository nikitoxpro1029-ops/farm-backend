import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import farmRoutes from './routes/farm.js';
import packRoutes from './routes/packs.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/farm', farmRoutes);
app.use('/api/packs', packRoutes);

app.get('/', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));