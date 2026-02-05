# Avatar Conversation App

## Overview
A queue-based conversation web app with avatar using Deepgram transcription. This is a Node.js/Express WebSocket server that manages user conversations in a queue system.

## Project Structure
- `server.js` - Main Express + WebSocket server
- `public/` - Static files directory
  - `index.html` - Main user interface
  - `admin.html` - Admin panel for queue management

## Features
- WebSocket-based real-time communication
- Queue management system for users
- Admin panel for conversation management
- Unity client support for avatar integration

## Running the App
The app runs on port 5000 using `npm start`.

## Unity Connection
Unity clients should connect via WebSocket to the server and identify themselves:
1. Connect to: `wss://<your-replit-domain>`
2. Send identify message: `{ "type": "identify", "client": "unity" }`
3. Server will forward these messages to Unity:
   - `new_active_user` - When a new user becomes active
   - `user_left` - When active user leaves
   - `conversation_started` - When conversation begins
   - `transcription` - Speech transcription (text, isFinal, userId, username, timestamp)
   - `queue_status` - Queue updates
   - `avatar_idle` - When no users are active

Debug endpoint: GET `/status` returns current server state and Unity connection info.

## Recent Changes
- February 5, 2026: Complete UI redesign (Mobile-first)
  - Mobile-first design optimized for iOS and Android
  - Refined, timeless avatar icon (abstract geometric design instead of emoji)
  - Hold-to-talk recording (like WhatsApp voice messages)
  - Haptic feedback on mobile (vibration)
  - iOS safe area support (notch, home indicator)
  - Clean, minimal interface with subtle animations
  - Queue overlay for waiting users
  - Responsive scaling for tablet/desktop
  - Terms and Conditions popup after name entry
  - Simplified speaking page: just studio mic icon, talk button, close button
  - Transcription moved to admin panel (real-time live view)
  - Admin panel now shows live transcription with timestamps

- February 4, 2026: Initial setup for Replit environment
  - Changed port from 8080 to 5000
  - Bound server to 0.0.0.0 for Replit compatibility
