const isProd = import.meta.env.PROD;

export const API_URL = isProd 
  ? 'https://aarzoo-server.onrender.com/api' 
  : 'http://localhost:3001/api';

export const WS_URL = isProd 
  ? 'wss://aarzoo-server.onrender.com' 
  : 'ws://localhost:3001';
