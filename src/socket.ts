import { Server } from 'socket.io';
import { createClient } from 'redis';
import http from 'http';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const initSockets = async (server: http.Server) => {
  const io = new Server(server, { cors: { origin: '*' } });
  
  const redisPub = createClient({ url: REDIS_URL });
  const redisSub = redisPub.duplicate();
  await redisPub.connect();
  await redisSub.connect();

  io.on('connection', async (socket) => {
    // Ideally authentication happens here using JWT...
    const userId = socket.handshake.auth.userId; 
    if (!userId) return socket.disconnect();

    // Track user session in Redis
    await redisPub.hSet('online_users', userId, socket.id);

    // Private Messaging
    socket.on('private_message', async (data) => {
      const { recipientId, encryptedText, conversationId } = data;
      const recipientSocket = await redisPub.hGet('online_users', recipientId);
      
      if (recipientSocket) {
        io.to(recipientSocket).emit('receive_private', {
          senderId: userId,
          encryptedText,
          conversationId,
          timestamp: Date.now()
        });
      }
    });

    // Group Messaging using Redis Pub/Sub (Zero-Cost Scaling)
    socket.on('join_group', async (groupId) => {
      socket.join(`group:${groupId}`);
      // Subscribe to Redis Channel for this group
      await redisSub.subscribe(`channel:group:${groupId}`, (message) => {
        io.to(`group:${groupId}`).emit('receive_group', JSON.parse(message));
      });
    });

    socket.on('group_message', async (data) => {
      const { groupId, encryptedText, senderName } = data;
      // Broadcast to Redis Channel so ALL servers get the message
      await redisPub.publish(`channel:group:${groupId}`, JSON.stringify({
        senderId: userId,
        senderName,
        groupId,
        encryptedText,
        timestamp: Date.now()
      }));
    });

    socket.on('disconnect', async () => {
      await redisPub.hDel('online_users', userId);
    });

    // --- LiveKit Call Signaling ---
    
    // 1-on-1 Call Request
    socket.on('request_call', async (data) => {
      const { recipientId, roomId } = data;
      const recipientSocket = await redisPub.hGet('online_users', recipientId);
      if (recipientSocket) {
        io.to(recipientSocket).emit('incoming_call', { callerId: userId, roomId });
      }
    });

    // Group Call Request (Zero-Cost Broadcasting)
    socket.on('start_group_call', async (data) => {
      const { groupId, roomId } = data;
      // Publish event to Redis, all connected servers will forward it to their local sockets
      await redisPub.publish(`channel:group:${groupId}`, JSON.stringify({
        type: 'GROUP_CALL',
        callerId: userId,
        groupId,
        roomId
      }));
    });
  });
};
