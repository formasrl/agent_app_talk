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
