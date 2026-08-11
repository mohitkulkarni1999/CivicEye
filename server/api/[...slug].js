import { app } from '../src/app.js';
import { testConnection } from '../src/config/db.js';

testConnection().catch((err) => {
  console.error('Failed to connect to PostgreSQL on cold start', err);
});

export default app;
