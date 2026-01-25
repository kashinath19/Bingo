const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Store active players
let players = {};

// ========================================
// XOXO Multiplayer Game State
// ========================================
let xoxoRooms = {};
let xoxoQueue = []; // Players waiting for a match

function createXOXORoom(player1, player2) {
    const roomId = `xoxo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    xoxoRooms[roomId] = {
        roomId: roomId,
        players: {
            X: player1,
            O: player2
        },
        board: Array(9).fill(''),
        currentPlayer: 'X',
        gameActive: true,
        winner: null,
        winningPattern: null
    };
    return roomId;
}

function checkXOXOWinner(board) {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { winner: board[a], pattern: pattern };
        }
    }

    // Check for draw
    if (board.every(cell => cell !== '')) {
        return { winner: 'draw', pattern: null };
    }

    return null;
}

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

    // ========================================
    // XOXO Multiplayer Events
    // ========================================

    // Player wants to find a match
    socket.on('xoxo_find_match', () => {
        const username = players[socket.id];
        if (!username) return;

        // Check if player is already in queue or game
        const existingQueueIndex = xoxoQueue.findIndex(p => p.socketId === socket.id);
        if (existingQueueIndex !== -1) return;

        // Check if player is already in a game
        for (const roomId in xoxoRooms) {
            const room = xoxoRooms[roomId];
            if (room.players.X.socketId === socket.id || room.players.O.socketId === socket.id) {
                socket.emit('xoxo_already_in_game', { roomId });
                return;
            }
        }

        const playerData = {
            socketId: socket.id,
            username: username
        };

        if (xoxoQueue.length > 0) {
            // Match found - create game room
            const opponent = xoxoQueue.shift();
            const roomId = createXOXORoom(opponent, playerData);

            // Join both players to the room
            const opponentSocket = io.sockets.sockets.get(opponent.socketId);
            if (opponentSocket) {
                opponentSocket.join(roomId);
            }
            socket.join(roomId);

            // Notify both players
            io.to(roomId).emit('xoxo_game_start', {
                roomId: roomId,
                players: {
                    X: { username: opponent.username, socketId: opponent.socketId },
                    O: { username: playerData.username, socketId: playerData.socketId }
                },
                board: xoxoRooms[roomId].board,
                currentPlayer: 'X'
            });

            // Announce in chat
            io.emit('chat_message', {
                user: 'System',
                text: `🎮 XOXO Match: ${opponent.username} (X) vs ${playerData.username} (O) started!`,
                type: 'system'
            });
        } else {
            // Add to queue
            xoxoQueue.push(playerData);
            socket.emit('xoxo_waiting', {
                message: 'Waiting for opponent...'
            });
        }
    });

    // Leave matchmaking queue
    socket.on('xoxo_cancel_search', () => {
        const index = xoxoQueue.findIndex(p => p.socketId === socket.id);
        if (index !== -1) {
            xoxoQueue.splice(index, 1);
            socket.emit('xoxo_search_cancelled');
        }
    });

    // Handle player move
    socket.on('xoxo_move', (data) => {
        const { roomId, cellIndex } = data;
        const room = xoxoRooms[roomId];

        if (!room || !room.gameActive) return;

        // Verify it's this player's turn
        const playerSymbol = room.players.X.socketId === socket.id ? 'X' :
            room.players.O.socketId === socket.id ? 'O' : null;

        if (!playerSymbol || playerSymbol !== room.currentPlayer) {
            socket.emit('xoxo_invalid_move', { message: 'Not your turn!' });
            return;
        }

        // Verify cell is empty
        if (room.board[cellIndex] !== '') {
            socket.emit('xoxo_invalid_move', { message: 'Cell already taken!' });
            return;
        }

        // Make the move
        room.board[cellIndex] = playerSymbol;

        // Check for winner
        const result = checkXOXOWinner(room.board);

        if (result) {
            room.gameActive = false;
            room.winner = result.winner;
            room.winningPattern = result.pattern;

            // Get winner/loser info
            let winnerData = null;
            let loserData = null;

            if (result.winner === 'X') {
                winnerData = room.players.X;
                loserData = room.players.O;
            } else if (result.winner === 'O') {
                winnerData = room.players.O;
                loserData = room.players.X;
            }

            // Broadcast game end to both players
            io.to(roomId).emit('xoxo_game_end', {
                board: room.board,
                winner: result.winner,
                winningPattern: result.pattern,
                winnerInfo: winnerData,
                loserInfo: loserData
            });

            // Auto-submit result to chat
            let resultMessage = '';
            if (result.winner === 'draw') {
                resultMessage = `🎮 XOXO: Match ended in a Draw! 🤝`;
            } else {
                resultMessage = `🎮 XOXO: ${winnerData.username} (${result.winner}) won the match! 🏆`;
            }

            io.emit('chat_message', {
                user: 'System',
                text: resultMessage,
                type: 'xoxo_result'
            });

            // Send detailed result payload (for external integrations)
            io.to(roomId).emit('xoxo_result_payload', {
                winner: result.winner === 'draw' ? 'Draw' : winnerData.username,
                status: 'completed',
                result: result.winner === 'draw' ? 'Draw' : `${result.winner} won`,
                players: {
                    X: room.players.X.username,
                    O: room.players.O.username
                }
            });
        } else {
            // Switch turn
            room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';

            // Broadcast updated state
            io.to(roomId).emit('xoxo_state_update', {
                board: room.board,
                currentPlayer: room.currentPlayer,
                lastMove: { cellIndex, player: playerSymbol }
            });
        }
    });

    // Handle new game request (rematch)
    socket.on('xoxo_new_game', (data) => {
        const { roomId } = data;
        const room = xoxoRooms[roomId];

        if (!room) return;

        // Reset game state
        room.board = Array(9).fill('');
        room.currentPlayer = 'X';
        room.gameActive = true;
        room.winner = null;
        room.winningPattern = null;

        // Broadcast new game start
        io.to(roomId).emit('xoxo_game_restart', {
            roomId: roomId,
            board: room.board,
            currentPlayer: 'X',
            players: room.players
        });
    });

    // Handle leaving the game
    socket.on('xoxo_leave_game', (data) => {
        const { roomId } = data;
        const room = xoxoRooms[roomId];

        if (!room) return;

        const username = players[socket.id];

        // Notify opponent
        io.to(roomId).emit('xoxo_opponent_left', {
            username: username
        });

        // Clean up room
        socket.leave(roomId);
        delete xoxoRooms[roomId];
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        const username = players[socket.id];

        // Remove from matchmaking queue
        const queueIndex = xoxoQueue.findIndex(p => p.socketId === socket.id);
        if (queueIndex !== -1) {
            xoxoQueue.splice(queueIndex, 1);
        }

        // Handle active games
        for (const roomId in xoxoRooms) {
            const room = xoxoRooms[roomId];
            if (room.players.X.socketId === socket.id || room.players.O.socketId === socket.id) {
                if (room.gameActive) {
                    // Opponent wins by default
                    const winner = room.players.X.socketId === socket.id ? room.players.O : room.players.X;
                    room.gameActive = false;
                    room.winner = room.players.X.socketId === socket.id ? 'O' : 'X';

                    io.to(roomId).emit('xoxo_opponent_disconnected', {
                        disconnectedPlayer: username,
                        winner: winner.username
                    });

                    io.emit('chat_message', {
                        user: 'System',
                        text: `🎮 XOXO: ${username} disconnected. ${winner.username} wins by default!`,
                        type: 'xoxo_result'
                    });
                }
                delete xoxoRooms[roomId];
                break;
            }
        }

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
