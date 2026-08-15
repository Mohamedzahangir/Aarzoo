# Aarzoo 

Aarzoo is a private, temporary, 1-to-1 shared experience platform allowing exactly two users to connect via a shared link without accounts. 

## How to run the application

This project is split into two parts: the `client` (Frontend React app) and the `server` (Backend Node.js/WebSocket server). You will need two separate terminal windows to run both simultaneously.

### 1. Run the Backend Server
Open your first terminal, navigate to the `server` folder, and start the development server:

```bash
cd server
npm install
npm run dev
```
*The server will start running on http://localhost:3001.*

### 2. Run the Frontend Client
Open a second, new terminal, navigate to the `client` folder, and start the Vite development server:

```bash
cd client
npm install
npm run dev
```
*The frontend will start running on http://localhost:5173.*

### 3. Open in Browser
Once both servers are running, open your browser and navigate to:
**http://localhost:5173**

You can test the application by opening two separate browser windows (or one normal window and one Incognito window), creating an Aarzoo in one, and opening the copied invite link in the other.
