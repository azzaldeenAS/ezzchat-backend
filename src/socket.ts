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
    const userName = socket.handshake.auth.userName || 'User';
    if (!userId) return socket.disconnect();

    // Track user session in Redis
    await redisPub.hSet('online_users', userId, JSON.stringify({ id: userId, name: userName, socketId: socket.id }));

    const broadcastOnlineUsers = async () => {
      const usersMap = await redisPub.hGetAll('online_users');
      const usersList = Object.values(usersMap).map(u => JSON.parse(u));
      io.emit('online_users_list', usersList);
    };

    await broadcastOnlineUsers();

    // Private Messaging
    socket.on('private_message', async (data) => {
      const { recipientId, encryptedText, type, mediaData } = data;
      const recipientDataStr = await redisPub.hGet('online_users', recipientId);
      
      if (recipientDataStr) {
        const recipientData = JSON.parse(recipientDataStr);
        io.to(recipientData.socketId).emit('receive_private', {
          senderId: userId,
          senderName: userName,
          encryptedText,
          type,
          mediaData,
          timestamp: Date.now()
        });
      }
    });

    // Group Messaging using Redis Pub/Sub (Zero-Cost Scaling)
    socket.on('join_group', async (groupId) => {
      socket.join(`group:${groupId}`);
      await redisSub.subscribe(`channel:group:${groupId}`, (message) => {
        io.to(`group:${groupId}`).emit('receive_group', JSON.parse(message));
      });
    });

    socket.on('group_message', async (data) => {
      const { groupId, encryptedText, senderName, type, mediaData } = data;
      await redisPub.publish(`channel:group:${groupId}`, JSON.stringify({
        senderId: userId,
        senderName,
        groupId,
        encryptedText,
        type,
        mediaData,
        timestamp: Date.now()
      }));
    });

    socket.on('disconnect', async () => {
      await redisPub.hDel('online_users', userId);
      await broadcastOnlineUsers();
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
