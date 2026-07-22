import express from 'express';
import http from 'http';
import cors from 'cors';
import { initSockets } from './socket';
import { generateCallToken } from './controllers/callController';

const app = express();
app.use(cors());
app.use(express.json());

// Auth endpoints would go here
// app.post('/auth/google', authController);

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
