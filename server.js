const WebSocket = require('ws');
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 8080;

// Create Express app
const app = express();

// Serve static files from 'public' folder
app.use(express.static('public'));

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create HTTP server with Express
const server = require('http').createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// ========== STATE MANAGEMENT ==========
let activeUser = null; // { ws, userId, username, startTime }
const waitingQueue = []; // [{ ws, userId, username, joinTime }]
const unityClients = new Set();
let avatarState = 'idle'; // 'idle' | 'busy'
let userIdCounter = 0;

// ========== WEBSOCKET CONNECTION ==========
wss.on('connection', (ws, req) => {
  console.log('New connection from:', req.socket.remoteAddress);
  
  let clientType = null;
  let userId = null;
  let username = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data.type, data);

      switch (data.type) {
        case 'identify':
          handleIdentify(ws, data);
          break;

        case 'start_conversation':
          handleStartConversation(ws);
          break;

        case 'transcription':
          handleTranscription(ws, data);
          break;

        case 'end_conversation':
          handleEndConversation(ws);
          break;

        case 'leave_queue':
          handleLeaveQueue(ws);
          break;

        default:
          console.log('Unknown message type:', data.type);
      }

    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // ========== IDENTIFY CLIENT ==========
  function handleIdentify(ws, data) {
    clientType = data.client;

    if (clientType === 'unity') {
      // Unity client
      unityClients.add(ws);
      console.log('✅ Unity client connected. Total Unity clients:', unityClients.size);

    } else if (clientType === 'web') {
      // Web client
      userId = `user_${++userIdCounter}`;
      username = data.username || `User${userIdCounter}`;

      ws.userId = userId;
      ws.username = username;
      ws.clientType = 'web';

      console.log(`✅ Web client registered: ${username} (${userId})`);

      // Register user
      registerUser(ws);
    }
  }

  // ========== REGISTER USER ==========
  function registerUser(ws) {
    if (avatarState === 'idle') {
      // Avatar is free - promote to active
      promoteToActive(ws);
    } else {
      // Avatar is busy - add to queue
      addToQueue(ws);
    }
  }

  // ========== PROMOTE TO ACTIVE ==========
  function promoteToActive(ws) {
    activeUser = {
      ws: ws,
      userId: ws.userId,
      username: ws.username,
      startTime: new Date()
    };

    avatarState = 'busy';

    console.log(`🟢 Promoted to active: ${ws.username} (${ws.userId})`);

    // Notify user they are active
    sendToClient(ws, {
      type: 'registered',
      userId: ws.userId,
      state: 'active'
    });

    // Notify Unity
    broadcastToUnity({
      type: 'new_active_user',
      userId: ws.userId,
      username: ws.username,
      timestamp: new Date().toISOString()
    });

    // Update queue positions for waiting users
    broadcastQueueUpdate();
  }

  // ========== ADD TO QUEUE ==========
  function addToQueue(ws) {
    const queueEntry = {
      ws: ws,
      userId: ws.userId,
      username: ws.username,
      joinTime: new Date()
    };

    waitingQueue.push(queueEntry);

    const position = waitingQueue.length;

    console.log(`🟡 Added to queue: ${ws.username} (${ws.userId}) - Position: ${position}`);

    // Notify user they are in queue
    sendToClient(ws, {
      type: 'registered',
      userId: ws.userId,
      state: 'waiting',
      queuePosition: position
    });

    // Notify user about active user
    if (activeUser) {
      sendToClient(ws, {
        type: 'avatar_busy',
        activeUser: activeUser.username
      });
    }

    // Notify Unity
    broadcastToUnity({
      type: 'queue_status',
      waiting: waitingQueue.length,
      timestamp: new Date().toISOString()
    });
  }

  // ========== START CONVERSATION ==========
  function handleStartConversation(ws) {
    // Verify this is the active user
    if (!activeUser || activeUser.ws !== ws) {
      console.log('❌ Unauthorized start_conversation from:', ws.userId);
      return;
    }

    console.log(`💬 Conversation started: ${ws.username}`);

    // Confirm to user
    sendToClient(ws, {
      type: 'conversation_started'
    });

    // Notify Unity
    broadcastToUnity({
      type: 'conversation_started',
      userId: ws.userId,
      username: ws.username,
      timestamp: new Date().toISOString()
    });
  }

  // ========== HANDLE TRANSCRIPTION ==========
  function handleTranscription(ws, data) {
    // Verify this is the active user
    if (!activeUser || activeUser.ws !== ws) {
      console.log('❌ Unauthorized transcription from:', ws.userId);
      return;
    }

    console.log(`📝 Transcription [${data.isFinal ? 'FINAL' : 'INTERIM'}]: ${data.text}`);

    // Forward to Unity
    broadcastToUnity({
      type: 'transcription',
      text: data.text,
      isFinal: data.isFinal,
      userId: ws.userId,
      username: ws.username,
      timestamp: data.timestamp || new Date().toISOString()
    });
  }

  // ========== END CONVERSATION ==========
  function handleEndConversation(ws) {
    // Verify this is the active user
    if (!activeUser || activeUser.ws !== ws) {
      console.log('❌ Unauthorized end_conversation from:', ws.userId);
      return;
    }

    console.log(`🚪 Conversation ended: ${ws.username}`);

    releaseControl();
    promoteNextUser();
  }

  // ========== LEAVE QUEUE ==========
  function handleLeaveQueue(ws) {
    const index = waitingQueue.findIndex(entry => entry.ws === ws);

    if (index !== -1) {
      waitingQueue.splice(index, 1);
      console.log(`❌ User left queue: ${ws.username} (${ws.userId})`);

      // Update queue positions
      broadcastQueueUpdate();

      // Notify Unity
      broadcastToUnity({
        type: 'queue_status',
        waiting: waitingQueue.length,
        timestamp: new Date().toISOString()
      });
    }
  }

  // ========== HANDLE DISCONNECT ==========
  function handleDisconnect(ws) {
    if (ws.clientType === 'unity') {
      // Unity disconnected
      unityClients.delete(ws);
      console.log('❌ Unity client disconnected. Total Unity clients:', unityClients.size);

    } else if (ws.clientType === 'web') {
      // Web client disconnected
      console.log(`❌ Web client disconnected: ${ws.username} (${ws.userId})`);

      if (activeUser && activeUser.ws === ws) {
        // Active user disconnected
        console.log('⚠️ Active user disconnected - releasing control');
        releaseControl();
        promoteNextUser();

      } else {
        // Waiting user disconnected
        const index = waitingQueue.findIndex(entry => entry.ws === ws);
        if (index !== -1) {
          waitingQueue.splice(index, 1);
          console.log('Removed from queue');
          broadcastQueueUpdate();
        }
      }
    }
  }
});

// ========== RELEASE CONTROL ==========
function releaseControl() {
  if (!activeUser) return;

  console.log(`🔓 Releasing control from: ${activeUser.username}`);

  activeUser = null;
  avatarState = 'idle';

  // Notify Unity
  broadcastToUnity({
    type: 'user_left',
    timestamp: new Date().toISOString()
  });
}

// ========== PROMOTE NEXT USER ==========
function promoteNextUser() {
  if (waitingQueue.length > 0) {
    const nextUser = waitingQueue.shift();

    console.log(`⏭️ Promoting next user: ${nextUser.username} (${nextUser.userId})`);

    // Promote to active
    activeUser = {
      ws: nextUser.ws,
      userId: nextUser.userId,
      username: nextUser.username,
      startTime: new Date()
    };

    avatarState = 'busy';

    // Notify promoted user
    sendToClient(nextUser.ws, {
      type: 'promoted_to_active'
    });

    // Notify Unity
    broadcastToUnity({
      type: 'new_active_user',
      userId: nextUser.userId,
      username: nextUser.username,
      timestamp: new Date().toISOString()
    });

    // Update queue positions
    broadcastQueueUpdate();

  } else {
    console.log('📭 No users waiting - avatar returning to idle');
    avatarState = 'idle';

    // Notify Unity
    broadcastToUnity({
      type: 'avatar_idle',
      timestamp: new Date().toISOString()
    });
  }
}

// ========== BROADCAST QUEUE UPDATE ==========
function broadcastQueueUpdate() {
  waitingQueue.forEach((entry, index) => {
    const position = index + 1;
    sendToClient(entry.ws, {
      type: 'queue_update',
      position: position,
      totalWaiting: waitingQueue.length
    });
  });

  // Notify Unity
  broadcastToUnity({
    type: 'queue_status',
    waiting: waitingQueue.length,
    timestamp: new Date().toISOString()
  });
}

// ========== SEND TO CLIENT ==========
function sendToClient(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (error) {
      console.error('Error sending to client:', error);
    }
  }
}

// ========== BROADCAST TO UNITY ==========
function broadcastToUnity(data) {
  unityClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error('Error sending to Unity:', error);
      }
    }
  });

  console.log('📤 Sent to Unity:', data.type);
}

// ========== START SERVER ==========
server.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🚀 WebSocket Relay Server running on port ${PORT}`);
  console.log('📋 Queue-based conversation management enabled');
  console.log('🤖 Single active user mode with waiting queue');
  console.log('═══════════════════════════════════════════════════════');
});
