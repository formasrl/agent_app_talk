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
- February 4, 2026: Initial setup for Replit environment
  - Changed port from 8080 to 5000
  - Bound server to 0.0.0.0 for Replit compatibility
