const WebSocket = require('ws');
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 5000;

// Create Express app
const app = express();

// Serve static files from 'public' folder
app.use(express.static('public'));

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Status endpoint for debugging Unity connections
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    avatarState: avatarState,
    activeUser: activeUser ? { userId: activeUser.userId, username: activeUser.username } : null,
    waitingQueue: waitingQueue.length,
    unityClients: unityClients.size,
    adminClients: adminClients.size,
    wsEndpoint: 'wss://' + req.get('host'),
    unityProtocol: 'Connect via WebSocket and send: { "type": "identify", "client": "unity" }'
  });
});

// Simple ping endpoint for Unity to test HTTP connectivity
app.get('/ping', (req, res) => {
  console.log('🏓 Ping received from:', req.ip);
  res.send('pong');
});

// Create HTTP server with Express
const server = require('http').createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// ========== STATE MANAGEMENT ==========
let activeUser = null; // { ws, userId, username, startTime }
const waitingQueue = []; // [{ ws, userId, username, joinTime }]
const unityClients = new Set();
const adminClients = new Set(); // NEW: Admin clients
let avatarState = 'idle'; // 'idle' | 'busy'
let userIdCounter = 0;

// ========== WEBSOCKET CONNECTION ==========
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  console.log('═══════════════════════════════════════════════════════');
  console.log('🔌 New WebSocket connection:');
  console.log('   IP:', req.socket.remoteAddress);
  console.log('   Origin:', origin);
  console.log('   User-Agent:', userAgent.substring(0, 50));
  console.log('═══════════════════════════════════════════════════════');
  
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

        // ========== ADMIN MESSAGES ==========
        case 'admin_get_state':
          handleAdminGetState(ws);
          break;

        case 'admin_command':
          handleAdminCommand(ws, data);
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
      ws.clientType = 'unity';
      console.log('✅ Unity client connected. Total Unity clients:', unityClients.size);
      broadcastAdminStateUpdate();

    } else if (clientType === 'admin') {
      // Admin client
      adminClients.add(ws);
      ws.clientType = 'admin';
      console.log('✅ Admin client connected. Total Admin clients:', adminClients.size);
      
      // Send current state immediately
      sendAdminStateUpdate(ws);

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

    // Notify admins
    broadcastAdminStateUpdate();
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

    // Notify admins
    broadcastAdminStateUpdate();
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

    const transcriptionData = {
      type: 'transcription',
      text: data.text,
      isFinal: data.isFinal,
      userId: ws.userId,
      username: ws.username,
      timestamp: data.timestamp || new Date().toISOString()
    };

    // Forward to Unity
    broadcastToUnity(transcriptionData);

    // Forward to Admin clients
    broadcastToAdmins(transcriptionData);
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

      // Notify admins
      broadcastAdminStateUpdate();
    }
  }

  // ========== ADMIN GET STATE ==========
  function handleAdminGetState(ws) {
    if (ws.clientType !== 'admin') {
      console.log('❌ Unauthorized admin_get_state from non-admin client');
      return;
    }

    sendAdminStateUpdate(ws);
  }

  // ========== ADMIN COMMAND ==========
  function handleAdminCommand(ws, data) {
    if (ws.clientType !== 'admin') {
      console.log('❌ Unauthorized admin_command from non-admin client');
      return;
    }

    console.log(`🔧 Admin command: ${data.action}`, data);

    switch (data.action) {
      case 'close_conversation':
        adminCloseConversation(data.userId);
        break;

      case 'demote_to_queue':
        adminDemoteToQueue(data.userId);
        break;

      case 'promote_user':
        adminPromoteUser(data.index);
        break;

      case 'remove_from_queue':
        adminRemoveFromQueue(data.index);
        break;

      case 'move_in_queue':
        adminMoveInQueue(data.fromIndex, data.toIndex);
        break;

      default:
        console.log('Unknown admin action:', data.action);
    }
  }

  // ========== HANDLE DISCONNECT ==========
  function handleDisconnect(ws) {
    if (ws.clientType === 'unity') {
      // Unity disconnected
      unityClients.delete(ws);
      console.log('❌ Unity client disconnected. Total Unity clients:', unityClients.size);
      broadcastAdminStateUpdate();

    } else if (ws.clientType === 'admin') {
      // Admin disconnected
      adminClients.delete(ws);
      console.log('❌ Admin client disconnected. Total Admin clients:', adminClients.size);

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
          broadcastAdminStateUpdate();
        }
      }
    }
  }
});

// ========== ADMIN ACTIONS ==========

function adminCloseConversation(userId) {
  if (!activeUser || activeUser.userId !== userId) {
    console.log('❌ No active user to close or userId mismatch');
    return;
  }

  console.log(`🔧 Admin closing conversation for: ${activeUser.username}`);

  // Notify user they were kicked
  sendToClient(activeUser.ws, {
    type: 'kicked_out',
    reason: 'La tua conversazione è stata chiusa dall\'amministratore'
  });

  // Close the connection
  activeUser.ws.close();

  releaseControl();
  promoteNextUser();
}

function adminDemoteToQueue(userId) {
  if (!activeUser || activeUser.userId !== userId) {
    console.log('❌ No active user to demote or userId mismatch');
    return;
  }

  console.log(`🔧 Admin demoting to queue: ${activeUser.username}`);

  const demotedUser = activeUser;

  // Release control
  releaseControl();

  // Add to front of queue
  waitingQueue.unshift({
    ws: demotedUser.ws,
    userId: demotedUser.userId,
    username: demotedUser.username,
    joinTime: new Date()
  });

  // Notify demoted user
  sendToClient(demotedUser.ws, {
    type: 'registered',
    userId: demotedUser.userId,
    state: 'waiting',
    queuePosition: 1
  });

  // Update queue
  broadcastQueueUpdate();

  // Promote next user (if any after the demoted one)
  promoteNextUser();
}

function adminPromoteUser(index) {
  if (index < 0 || index >= waitingQueue.length) {
    console.log('❌ Invalid queue index:', index);
    return;
  }

  console.log(`🔧 Admin promoting user at index ${index}`);

  // If there's an active user, demote them first
  if (activeUser) {
    const demotedUser = activeUser;
    
    // Release control
    releaseControl();

    // Add demoted user to front of queue
    waitingQueue.unshift({
      ws: demotedUser.ws,
      userId: demotedUser.userId,
      username: demotedUser.username,
      joinTime: new Date()
    });

    // Notify demoted user
    sendToClient(demotedUser.ws, {
      type: 'registered',
      userId: demotedUser.userId,
      state: 'waiting',
      queuePosition: 1
    });

    // Adjust index because we added to front
    index++;
  }

  // Get user to promote
  const userToPromote = waitingQueue.splice(index, 1)[0];

  // Promote them
  promoteToActive(userToPromote.ws);
}

function adminRemoveFromQueue(index) {
  if (index < 0 || index >= waitingQueue.length) {
    console.log('❌ Invalid queue index:', index);
    return;
  }

  const removedUser = waitingQueue.splice(index, 1)[0];
  console.log(`🔧 Admin removed from queue: ${removedUser.username}`);

  // Notify removed user
  sendToClient(removedUser.ws, {
    type: 'kicked_out',
    reason: 'Sei stato rimosso dalla coda dall\'amministratore'
  });

  // Close connection
  removedUser.ws.close();

  // Update queue
  broadcastQueueUpdate();
  broadcastAdminStateUpdate();
}

function adminMoveInQueue(fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= waitingQueue.length ||
      toIndex < 0 || toIndex >= waitingQueue.length) {
    console.log('❌ Invalid queue indices:', fromIndex, toIndex);
    return;
  }

  console.log(`🔧 Admin moving user from ${fromIndex} to ${toIndex}`);

  // Remove from old position
  const [user] = waitingQueue.splice(fromIndex, 1);

  // Insert at new position
  waitingQueue.splice(toIndex, 0, user);

  // Update queue
  broadcastQueueUpdate();
  broadcastAdminStateUpdate();
}

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

  // Notify admins
  broadcastAdminStateUpdate();
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

    // Notify admins
    broadcastAdminStateUpdate();

  } else {
    console.log('📭 No users waiting - avatar returning to idle');
    avatarState = 'idle';

    // Notify Unity
    broadcastToUnity({
      type: 'avatar_idle',
      timestamp: new Date().toISOString()
    });

    // Notify admins
    broadcastAdminStateUpdate();
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

// ========== BROADCAST TO ADMINS ==========
function broadcastToAdmins(data) {
  adminClients.forEach(admin => {
    if (admin.readyState === WebSocket.OPEN) {
      try {
        admin.send(JSON.stringify(data));
      } catch (error) {
        console.error('Error sending to admin:', error);
      }
    }
  });

  console.log('📤 Sent to Admins:', data.type);
}

// ========== ADMIN STATE UPDATE ==========
function sendAdminStateUpdate(adminWs) {
  const stateData = {
    type: 'admin_state_update',
    activeUser: activeUser ? {
      userId: activeUser.userId,
      username: activeUser.username,
      startTime: activeUser.startTime.toISOString()
    } : null,
    waitingQueue: waitingQueue.map(entry => ({
      userId: entry.userId,
      username: entry.username,
      joinTime: entry.joinTime.toISOString()
    })),
    avatarState: avatarState,
    unityClients: unityClients.size
  };

  if (adminWs.readyState === WebSocket.OPEN) {
    try {
      adminWs.send(JSON.stringify(stateData));
    } catch (error) {
      console.error('Error sending to admin:', error);
    }
  }
}

function broadcastAdminStateUpdate() {
  adminClients.forEach(admin => {
    sendAdminStateUpdate(admin);
  });
}

// ========== START SERVER ==========
server.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🚀 WebSocket Relay Server running on port ${PORT}`);
  console.log('📋 Queue-based conversation management enabled');
  console.log('🤖 Single active user mode with waiting queue');
  console.log('🔧 Admin panel enabled at /admin.html');
  console.log('═══════════════════════════════════════════════════════');
});
