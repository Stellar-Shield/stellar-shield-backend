import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth';
import guardRoutes from './routes/guard';
import registryRoutes from './routes/registry';
import txRoutes from './routes/tx';
import { startEventMonitor } from './services/eventMonitor';
import { scheduleWaveAutomation } from './services/waveAutomation';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/guard', guardRoutes);
app.use('/registry', registryRoutes);
app.use('/tx', txRoutes);

app.get('/health', (_req, res) => res.json({ status: 'StellarShield Online' }));

app.listen(PORT, () => {
  console.log(`🛡️  StellarShield backend running on port ${PORT}`);
  startEventMonitor();
  scheduleWaveAutomation();
});
