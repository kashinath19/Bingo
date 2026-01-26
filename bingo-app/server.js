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
// Separate queues for different grid sizes
let xoxoQueues = {
    3: [], // 3x3 queue
    5: []  // 5x5 queue
};

function createXOXORoom(player1, player2, gridSize = 3) {
    const roomId = `xoxo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const totalCells = gridSize * gridSize;
    xoxoRooms[roomId] = {
        roomId: roomId,
        gridSize: gridSize,
        players: {
            X: player1,
            O: player2
        },
        board: Array(totalCells).fill(''),
        currentPlayer: 'X',
        gameActive: true,
        winner: null,
        winningPattern: null
    };
    return roomId;
}

function checkXOXOWinner(board, gridSize = 3) {
    const size = gridSize;
    const winLength = size; // Need N in a row for NxN grid

    // Generate win patterns dynamically
    const winPatterns = [];

    // Rows
    for (let r = 0; r < size; r++) {
        const row = [];
        for (let c = 0; c < size; c++) {
            row.push(r * size + c);
        }
        winPatterns.push(row);
    }

    // Columns
    for (let c = 0; c < size; c++) {
        const col = [];
        for (let r = 0; r < size; r++) {
            col.push(r * size + c);
        }
        winPatterns.push(col);
    }

    // Diagonal (top-left to bottom-right)
    const diag1 = [];
    for (let i = 0; i < size; i++) {
        diag1.push(i * size + i);
    }
    winPatterns.push(diag1);

    // Diagonal (top-right to bottom-left)
    const diag2 = [];
    for (let i = 0; i < size; i++) {
        diag2.push(i * size + (size - 1 - i));
    }
    winPatterns.push(diag2);

    // Check all patterns
    for (const pattern of winPatterns) {
        const first = board[pattern[0]];
        if (first && pattern.every(idx => board[idx] === first)) {
            return { winner: first, pattern: pattern };
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
    socket.on('xoxo_find_match', (data) => {
        const username = players[socket.id];
        if (!username) return;

        // Get grid size from client (default to 3)
        const gridSize = (data && (data.gridSize === 5 || data.gridSize === 3)) ? data.gridSize : 3;
        // Get player stats from client
        const playerStats = (data && data.stats) ? data.stats : { wins: 0, draws: 0, losses: 0 };

        const queue = xoxoQueues[gridSize];

        // Check if player is already in any queue
        for (const size in xoxoQueues) {
            const existingIndex = xoxoQueues[size].findIndex(p => p.socketId === socket.id);
            if (existingIndex !== -1) return;
        }

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
            username: username,
            gridSize: gridSize,
            stats: playerStats
        };

        if (queue.length > 0) {
            // Match found - create game room
            const opponent = queue.shift();
            const roomId = createXOXORoom(opponent, playerData, gridSize);

            // Join both players to the room
            const opponentSocket = io.sockets.sockets.get(opponent.socketId);
            if (opponentSocket) {
                opponentSocket.join(roomId);
            }
            socket.join(roomId);

            // Notify both players - include stats
            io.to(roomId).emit('xoxo_game_start', {
                roomId: roomId,
                gridSize: gridSize,
                players: {
                    X: { username: opponent.username, socketId: opponent.socketId, stats: opponent.stats },
                    O: { username: playerData.username, socketId: playerData.socketId, stats: playerData.stats }
                },
                board: xoxoRooms[roomId].board,
                currentPlayer: 'X'
            });

            // Announce in chat
            io.emit('chat_message', {
                user: 'System',
                text: `🎮 XOXO ${gridSize}x${gridSize} Match: ${opponent.username} (X) vs ${playerData.username} (O) started!`,
                type: 'system'
            });
        } else {
            // Add to queue
            queue.push(playerData);
            socket.emit('xoxo_waiting', {
                message: `Waiting for ${gridSize}x${gridSize} opponent...`
            });
        }
    });

    // Leave matchmaking queue
    socket.on('xoxo_cancel_search', () => {
        // Search all queues
        for (const size in xoxoQueues) {
            const index = xoxoQueues[size].findIndex(p => p.socketId === socket.id);
            if (index !== -1) {
                xoxoQueues[size].splice(index, 1);
                socket.emit('xoxo_search_cancelled');
                return;
            }
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
        const result = checkXOXOWinner(room.board, room.gridSize);

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
        const totalCells = room.gridSize * room.gridSize;
        room.board = Array(totalCells).fill('');
        room.currentPlayer = 'X';
        room.gameActive = true;
        room.winner = null;
        room.winningPattern = null;

        // Broadcast new game start
        io.to(roomId).emit('xoxo_game_restart', {
            roomId: roomId,
            gridSize: room.gridSize,
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

        // Remove from all matchmaking queues
        for (const size in xoxoQueues) {
            const queueIndex = xoxoQueues[size].findIndex(p => p.socketId === socket.id);
            if (queueIndex !== -1) {
                xoxoQueues[size].splice(queueIndex, 1);
            }
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
