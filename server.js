// server.js
const express = require('express');
const next = require('next');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config(); // Load environment variables

const port = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const DRAWING_DATA_FILE = path.join(__dirname, 'drawingData.json');

app.prepare().then(() => {
  const server = express();

  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword) {
    console.warn('ADMIN_PASSWORD is not set; nobody will be able to draw.');
  }

  const checkPassword = (password) => {
    if (!adminPassword || typeof password !== 'string') return false;
    const a = crypto.createHash('sha256').update(password).digest();
    const b = crypto.createHash('sha256').update(adminPassword).digest();
    return crypto.timingSafeEqual(a, b);
  };

  // Create HTTP server
  const httpServer = http.createServer(server);

  // Initialize Socket.IO server
  const io = new Server(httpServer);

  // Load the drawing data from file
  let drawingData = {
    paths: [],
    waypoints: [],
  };

  try {
    const data = fs.readFileSync(DRAWING_DATA_FILE, 'utf8');
    drawingData = JSON.parse(data);
    console.log('Drawing data loaded from file.');
  } catch (err) {
    console.log('No existing drawing data found. Starting fresh.');
  }

  // Function to save drawing data to file
  const saveDrawingData = () => {
    fs.writeFile(DRAWING_DATA_FILE, JSON.stringify(drawingData), (err) => {
      if (err) {
        console.error('Error saving drawing data:', err);
      } else {
        console.log('Drawing data saved to file.');
      }
    });
  };

  // Handle Socket.IO connections
  io.on('connection', (socket) => {
    socket.isAdmin = false; // Initialize isAdmin to false

    console.log(`User connected: ${socket.id}`);

    // The password is checked here, on the socket itself, so a client can't
    // skip the check and just claim to be admin.
    socket.on('authenticate', (password, reply) => {
      socket.isAdmin = checkPassword(password);
      console.log(`Socket ${socket.id} admin login ${socket.isAdmin ? 'ok' : 'failed'}.`);
      if (typeof reply === 'function') reply(socket.isAdmin);
    });

    // Handle logout event
    socket.on('logout', () => {
      socket.isAdmin = false;
      console.log(`Socket ${socket.id} logged out.`);
    });

    // Send the current drawing to the new client
    socket.emit('initialize', drawingData);

    // Broadcast drawing data to other clients
    socket.on('drawing', (data) => {
      if (socket.isAdmin) {
        drawingData.paths.push(data);
        socket.broadcast.emit('drawing', data);
        saveDrawingData();
      } else {
        console.log('Unauthorized drawing attempt by:', socket.id);
      }
    });

    // Handle clear event
    socket.on('clear', () => {
      if (socket.isAdmin) {
        drawingData.paths = [];
        socket.broadcast.emit('clear');
        saveDrawingData();
      } else {
        console.log('Unauthorized clear attempt by:', socket.id);
      }
    });

    // Handle undo event
    socket.on('undo', () => {
      if (socket.isAdmin) {
        if (drawingData.paths.length > 0) {
          drawingData.paths.pop();
          socket.broadcast.emit('undo');
          saveDrawingData();
        }
      } else {
        console.log('Unauthorized undo attempt by:', socket.id);
      }
    });

    // Handle waypoint updates
    socket.on('updateWaypoints', (waypoints) => {
      if (socket.isAdmin) {
        drawingData.waypoints = waypoints;
        socket.broadcast.emit('updateWaypoints', waypoints);
        saveDrawingData();
      } else {
        console.log('Unauthorized waypoint update attempt by:', socket.id);
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  // Handle Next.js requests
  server.all('*', (req, res) => {
    return handle(req, res);
  });

  // Start the server
  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
