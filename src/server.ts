import express from 'express';
import http from 'http';
import cors from 'cors';
import { initSockets } from './socket';
import { generateCallToken } from './controllers/callController';

const app = express();
app.use(cors());
app.use(express.json());

// Simple Login Endpoint (Mocking DB for Zero-Cost Setup)
app.post('/auth/login', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const fakeId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const user = {
      id: fakeId,
      name: name,
      email: `${name.toLowerCase().replace(/\\s/g, '')}@ezzchat.local`
    };
    res.json({ user, token: 'mock_jwt_token' });
  } catch (error: any) {
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

// Phase 4: LiveKit Endpoint
app.post('/api/call/token', generateCallToken);

const server = http.createServer(app);

// Initialize WebSockets
initSockets(server).then(() => {
  console.log("WebSockets & Redis Pub/Sub Initialized");
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
