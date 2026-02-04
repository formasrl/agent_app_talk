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

const clients = new Set();
const unityClients = new Set();
let activeWebClient = null; // Only ONE web client allowed

wss.on('connection', (ws, req) => {
  console.log('New connection from:', req.socket.remoteAddress);
  
  // Default to web client
  let clientType = 'web';
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Identify client type
      if (data.type === 'identify') {
        clientType = data.client;
        
        if (clientType === 'unity') {
          // Unity client connected
          unityClients.add(ws);
          console.log('✅ Unity client connected. Total Unity clients:', unityClients.size);
          
        } else {
          // WEB CLIENT - Single user enforcement
          
          // If there's already an active web client, kick them out
          if (activeWebClient && activeWebClient !== ws) {
            console.log('⚠️ Kicking out previous web client...');
            
            try {
              // Send kick message to old client
              activeWebClient.send(JSON.stringify({ 
                type: 'kicked_out',
                message: 'Un altro utente si è connesso. Sei stato disconnesso.'
              }));
              
              // Close the old connection
              activeWebClient.close(1000, 'Replaced by new user');
            } catch (error) {
              console.error('Error kicking out old client:', error);
            }
          }
          
          // Set new active web client
          activeWebClient = ws;
          console.log('✅ New web client connected (previous kicked out if any)');
          
          // ⭐ NOTIFY UNITY: New user connected
          broadcastToUnity({ 
            type: 'new_user_connected',
            timestamp: new Date().toISOString()
          });
        }
        
        clients.add(ws);
        return;
      }
      
      // Forward transcription data (only from active web client)
      if (data.text && ws === activeWebClient) {
        console.log(`Transcription [${data.isFinal ? 'FINAL' : 'INTERIM'}]:`, data.text);
        
        // Send to all Unity clients
        broadcastToUnity(data);
      }
      
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
  
  ws.on('close', () => {
    clients.delete(ws);
    
    if (unityClients.has(ws)) {
      // Unity disconnected
      unityClients.delete(ws);
      console.log('❌ Unity client disconnected. Total Unity clients:', unityClients.size);
    }
    
    if (ws === activeWebClient) {
      // Active web client disconnected
      activeWebClient = null;
      console.log('❌ Web client disconnected');
      
      // ⭐ NO notification to Unity on disconnect
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

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
}

server.listen(PORT, () => {
  console.log(`WebSocket Relay Server running on port ${PORT}`);
  console.log(`Server ready - Single user mode enabled`);
});
