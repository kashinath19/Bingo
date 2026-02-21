const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ========================================
// Global Blocking Page Template
// ========================================
const BLOCK_HTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Oops</title>
    <style>
        body { background-color: #f2f2f2; color: #202124; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; }
        .container { max-width: 600px; width: 90%; text-align: left; }
        .icon { width: 48px; height: 48px; margin-bottom: 24px; }
        h1 { font-size: 28px; font-weight: bold; margin: 0 0 16px 0; }
        p { font-size: 16px; line-height: 1.5; color: #5f6368; margin: 0 0 24px 0; }
        .error-code { font-size: 12px; color: #5f6368; margin-bottom: 24px; }
        .action-container { display: flex; justify-content: flex-end; margin-top: 32px; }
        button { background-color: #1a73e8; color: white; border: none; padding: 8px 24px; border-radius: 4px; font-size: 14px; font-weight: 500; cursor: pointer; box-shadow: 0 1px 2px 0 rgba(60,64,67,0.302), 0 1px 3px 1px rgba(60,64,67,0.149); transition: background-color 0.2s; }
        button:hover { background-color: #185abc; }
    </style>
</head>
<body>
    <div class="container">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <path d="M9 15l1-1 1 1"></path>
            <path d="M13 15l1-1 1 1"></path>
            <path d="M9 19c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5"></path>
        </svg>
        <h1>Oops</h1>
        <p>The server limit has been reached. Please upgrade to a higher plan to continue using the service.</p>
        <div class="error-code">Error code: SERVER_LIMIT_REACHED</div>
        <div class="action-container">
            <button onclick="window.location.reload()">Reload</button>
        </div>
    </div>
</body>
</html>`;

// ========================================
// Limit Caching Logic
// ========================================
let cachedCount = null;
let lastCheckTime = 0;
const CACHE_DURATION = 10000; // 10 seconds

async function getCachedTotalCount() {
    const now = Date.now();
    // Refresh cache if null or expired
    if (cachedCount === null || (now - lastCheckTime > CACHE_DURATION)) {
        try {
            // Count ALL rows in game_history
            const result = await pool.query('SELECT COUNT(*) FROM game_history');
            const count = parseInt(result.rows[0].count, 10);
            cachedCount = count;
            lastCheckTime = now;
            console.log(`[System] Total Game Count Updated: ${count}`);
        } catch (err) {
            console.error('[System] Error checking total count (FAIL-SAFE TRIGGERED):', err);
            // FAIL-SAFE: If DB fails, assume limit is reached to protect the system
            cachedCount = 5;
            lastCheckTime = now;
        }
    }
    return cachedCount;
}

// ========================================
// ========================================
// Global Middleware (Highest Priority)
// ========================================
// Regex to identify static assets that don't need limit protection (images, css, js)
// BUT we never skip HTML routes (/, /index.html) or API routes
const STATIC_ASSET_REGEX = /\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|json)$/i;

const checkGlobalLimit = async (req, res, next) => {
    // 1. Skip health checks
    if (req.path === '/health') return next();

    // 2. Allow access to the limit page itself to avoid infinite loops
    if (req.path === '/server_limit.html' || req.path === '/server-limit') return next();

    // 3. Skip ONLY non-HTML static assets
    if (STATIC_ASSET_REGEX.test(req.path)) {
        return next();
    }

    // 4. Check limit (Fail-safe defaults to 5)
    const count = await getCachedTotalCount();

    // STRICT BLOCKING CONDITION (>= 5 rows)
    if (count >= 5) {
        console.log(`[System] ZERO-BYPASS: Blocking access to ${req.path} (Count: ${count})`);
        // If it's an API call, return JSON or 403
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Server Limit Reached', code: 'LIMIT_EXCEEDED' });
        }
        // Otherwise return the hard-coded blocking HTML
        return res.status(403).send(BLOCK_HTML);
    }

    next();
};

app.use(checkGlobalLimit);

// Route for main game UI (Manual middleware application for zero bypass)
app.get('/', checkGlobalLimit, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', checkGlobalLimit, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Dedicated route for the server-limit page
app.get('/server-limit', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'server_limit.html'));
});

// Serve static assets (Protected by middleware above)
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
const connectionString = process.env.DATABASE_URL || 'postgresql://upi_devices_user:K7lqOpzbf9Afle4YVA6gyofYxidO2atr@dpg-d6abh8vpm1nc73d759r0-a.singapore-postgres.render.com/upi_devices';
const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test DB Connection
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    client.query('SELECT NOW()', (err, result) => {
        release();
        if (err) {
            return console.error('Error executing query', err.stack);
        }
        console.log('Database Connected Successfully:', result.rows[0]);
    });
});

// Initialize Database Table
const createTableQuery = `
    CREATE TABLE IF NOT EXISTS game_history (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        game_type VARCHAR(10) NOT NULL,
        result VARCHAR(10) NOT NULL,
        opponent VARCHAR(255),
        played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;

pool.query(createTableQuery)
    .then(() => console.log('Game history table created/verified'))
    .catch(err => console.error('Error creating table:', err));

// Store active players
let players = {};
const MAX_MATCHES = 5;
const SPECIAL_USER = "manogna🩵";

// Helper function to check user limit
// Helper function to check user limit
async function checkUserLimit(username) {
    if (!username) return false;

    // Check DB for count of completed games (wins/losses/draws)
    try {
        console.log(`Checking limit for user: ${username}`);
        const result = await pool.query('SELECT COUNT(*) FROM game_history WHERE username = $1', [username]);
        const count = parseInt(result.rows[0].count, 10);
        console.log(`User ${username} game count: ${count}`);

        if (count >= MAX_MATCHES) {
            console.log(`User ${username} BLOCKED (Limit Reached)`);
            return true;
        }
    } catch (err) {
        console.error('Error checking user limit:', err);
    }
    return false;
}

// Helper to record game result — re-checks row count before inserting and invalidates cache after
async function recordGameResult(username, gameType, result, opponent = null) {
    try {
        // RE-CHECK LIVE COUNT (Pre-insert check)
        const liveResult = await pool.query('SELECT COUNT(*) FROM game_history');
        const liveCount = parseInt(liveResult.rows[0].count, 10);

        if (liveCount >= 5) {
            console.warn(`[System] LIMIT BLOCKED INSERT: Current count is ${liveCount}`);
            return;
        }

        await pool.query(
            'INSERT INTO game_history (username, game_type, result, opponent) VALUES ($1, $2, $3, $4)',
            [username, gameType, result, opponent]
        );
        console.log(`Recorded game for ${username}: ${gameType} - ${result}`);

        // IMMEDIATELY INVALIDATE CACHE
        cachedCount = null;
        lastCheckTime = 0;
    } catch (err) {
        console.error('Error recording game result:', err);
    }
}


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

io.use(async (socket, next) => {
    const count = await getCachedTotalCount();
    if (count >= 5) {
        console.log(`[Socket] Connection rejected: Limit Reached (${count})`);
        next(new Error('Server Limit Reached'));
    } else {
        next();
    }
});

// ACTIVE SOCKET TERMINATION (Runs every 10 seconds)
setInterval(async () => {
    const count = await getCachedTotalCount();
    if (count >= 5) {
        const sockets = await io.fetchSockets();
        if (sockets.length > 0) {
            console.log(`[Socket] Limit Reached (${count}). Disconnecting ${sockets.length} active clients...`);
            io.emit('game_limit_reached', { message: 'The server limit has been reached. Please contact the administrator.' });
            io.disconnectSockets();
        }
    }
}, 10000);

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle new player joining
    socket.on('join', async (username) => {
        // Strict Limit Check FIRST
        const limitReached = await checkUserLimit(username);

        if (limitReached) {
            socket.emit('game_limit_reached', { message: 'Daily game limit reached.' });
            // Do NOT add to players list. Do NOT emit join success.
            return;
        }

        // Limit OK - Proceed to Join
        players[socket.id] = username;

        // Notify client to load UI - This is the key change
        socket.emit('join_success', { username: username });

        // Notify others
        io.emit('chat_message', {
            user: 'System',
            text: `${username} has joined the game!`,
            type: 'system'
        });
    });

    // Check Global Limit Action (e.g. for Start/Random Board)
    socket.on('request_limit_check', async () => {
        const count = await getCachedTotalCount();
        if (count >= 5) {
            socket.emit('game_limit_reached', { message: 'Server limit exceeded.' });
            socket.disconnect(true);
        } else {
            socket.emit('limit_check_passed');
        }
    });

    // Handle Chat Messages
    socket.on('chat_message', (msgData) => {
        io.emit('chat_message', msgData);
    });

    // Handle Bingo Win Declaration
    socket.on('bingo_win', async (username) => {
        io.emit('chat_message', {
            user: 'System',
            text: `🏆 ${username} shouts BINGO! 🏆`,
            type: 'win'
        });

        // Record win in DB
        await recordGameResult(username, 'BINGO', 'WIN');

        // Check limit after win
        const limitReached = await checkUserLimit(username);
        if (limitReached) {
            socket.emit('game_limit_reached', { message: 'You have reached the game limit.' });
        }
    });

    // Handle Bingo Game Start (for tracking limit only, no increment)
    socket.on('bingo_game_started', async () => {
        const username = players[socket.id];
        if (!username) return;

        // Check if limit already reached
        const limitReached = await checkUserLimit(username);
        if (limitReached) {
            socket.emit('game_limit_reached', { message: 'You have reached the game limit.' });
            return;
        }

        // DO NOT increment count here anymore. Only check.
        console.log(`User ${username} started Bingo. checking limit... OK.`);
    });

    // ========================================
    // XOXO Multiplayer Events
    // ========================================

    // Player wants to find a match
    socket.on('xoxo_find_match', async (data) => {
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

        // CHECK LIMITS BEFORE MATCHMAKING

        // Check Global Limit BEFORE matchmaking (Double Check)
        const globalCount = await getCachedTotalCount();
        if (globalCount >= 5) {
            socket.emit('game_limit_reached', { message: 'Server limit exceeded.' });
            return;
        }

        // Special Rule for specific user
        if (username === SPECIAL_USER) {
            socket.emit('game_limit_reached', { message: 'Special user restriction.' });
            return;
        }

        const limitReached = await checkUserLimit(username);
        if (limitReached) {
            socket.emit('game_limit_reached', { message: 'Limit reached.' });
            return;
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
            // Match found - check opponent for special rule too
            const opponent = queue.shift();

            // Special Rule: If opponent is the special user (should be caught earlier, but safety check)
            if (opponent.username === SPECIAL_USER) {
                const opponentSocket = io.sockets.sockets.get(opponent.socketId);
                if (opponentSocket) opponentSocket.emit('game_limit_reached', { message: 'Special restriction.' });
                socket.emit('game_limit_reached', { message: 'Opponent restriction.' });
                return;
            }

            // Check opponent limit too (double check)
            const opponentLimit = await checkUserLimit(opponent.username);
            if (opponentLimit) {
                const opponentSocket = io.sockets.sockets.get(opponent.socketId);
                if (opponentSocket) opponentSocket.emit('game_limit_reached');
                // Put current player back in queue or retry? Just fail this match.
                socket.emit('xoxo_waiting', { message: 'Opponent limit reached. Searching again...' });
                queue.push(playerData); // Re-queue current player
                return;
            }

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
    socket.on('xoxo_move', async (data) => {
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

            // INCREMENT COUNTS FOR BOTH PLAYERS (via DB)
            const p1Name = room.players.X.username;
            const p2Name = room.players.O.username;

            // Record results
            if (result.winner === 'draw') {
                await recordGameResult(p1Name, 'XOXO', 'DRAW', p2Name);
                await recordGameResult(p2Name, 'XOXO', 'DRAW', p1Name);
            } else {
                const winnerName = winnerData.username;
                const loserName = loserData.username;
                await recordGameResult(winnerName, 'XOXO', 'WIN', loserName);
                await recordGameResult(loserName, 'XOXO', 'LOSS', winnerName);
            }

            // Check milestones
            const p1Socket = io.sockets.sockets.get(room.players.X.socketId);
            const p2Socket = io.sockets.sockets.get(room.players.O.socketId);

            checkUserLimit(p1Name).then(limit => { if (limit && p1Socket) p1Socket.emit('game_limit_reached', { message: 'Limit reached' }); });
            checkUserLimit(p2Name).then(limit => { if (limit && p2Socket) p2Socket.emit('game_limit_reached', { message: 'Limit reached' }); });

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
        // Note: New Game request usually means restart with same players.
        // We probably should check limits here too?
        // Yes, if limit is reached, prevent new game.
        // But for simplicity, let's assume they exit to lobby or re-queue which checks limits.

        // Actually, let's verify limits for both players before allowing restart.
        if (!room) return;

        // This part is tricky because it's async inside an existing handler structure.
        // For now, let's rebuild the room reset logic to check limit.

        // Async checks
        Promise.all([
            checkUserLimit(room.players.X.username),
            checkUserLimit(room.players.O.username)
        ]).then(([limitX, limitO]) => {
            if (limitX || limitO) {
                io.to(roomId).emit('game_limit_reached', { message: 'One or both players reached the game limit.' });
                return;
            }

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
                    const loserName = room.players.X.socketId === socket.id ? room.players.X.username : room.players.O.username;
                    room.gameActive = false;
                    room.winner = room.players.X.socketId === socket.id ? 'O' : 'X';

                    io.to(roomId).emit('xoxo_opponent_disconnected', {
                        disconnectedPlayer: username,
                        winner: winner.username
                    });

                    // Record disconnection result
                    recordGameResult(winner.username, 'XOXO', 'WIN', loserName);
                    recordGameResult(loserName, 'XOXO', 'LOSS', winner.username);

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
