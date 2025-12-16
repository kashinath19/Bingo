const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Store active players (simplified)
let players = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle new player joining
    socket.on('join', (username) => {
        players[socket.id] = username;
        // Notify others
        io.emit('chat_message', { 
            user: 'System', 
            text: `${username} has joined the game!`, 
            type: 'system' 
        });
    });

    // Handle Chat Messages
    socket.on('chat_message', (msgData) => {
        io.emit('chat_message', msgData);
    });

    // Handle Bingo Win Declaration
    socket.on('bingo_win', (username) => {
        io.emit('chat_message', {
            user: 'System',
            text: `🏆 ${username} shouts BINGO! 🏆`,
            type: 'win'
        });
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        const username = players[socket.id];
        if (username) {
            io.emit('chat_message', { 
                user: 'System', 
                text: `${username} left the chat.`, 
                type: 'system' 
            });
            delete players[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});