const socket = io();
let username = "";
let board = [];        // numbers array length 25
let marked = [];       // boolean array length 25
let isGameActive = false;
let completedLines = []; // track which lines (rows/cols/diags) are complete

// ========================================
// XOXO Game State
// ========================================
let xoxoBoard = Array(9).fill('');
let xoxoCurrentPlayer = 'X';
let xoxoGameActive = false;
let xoxoGameOver = false;
let xoxoRoomId = null;
let xoxoMySymbol = null; // 'X' or 'O'
let xoxoOpponentName = '';
let xoxoIsMultiplayer = false;
let xoxoIsSearching = false;
let selectedGridSize = 3; // Default 3x3


// ========================================
// 1. Login Logic
// ========================================
function joinGame() {
    const input = document.getElementById('username-input');
    if (input.value.trim() === "") return alert("Please enter a name!");

    username = input.value.trim();
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';

    socket.emit('join', username);
    createEmptyBoard();
    initXOXOGame();
}

// Allow Enter key to join
document.getElementById('username-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') joinGame();
});

// ========================================
// Mobile Chat Initialization
// ========================================
function initMobileChat() {
    const chatInput = document.getElementById('msg-input');

    // Scroll chat to bottom when input is focused (ensures latest messages visible)
    if (chatInput) {
        chatInput.addEventListener('focus', function () {
            // Small delay to let virtual keyboard appear on mobile
            setTimeout(() => {
                scrollChatToBottom();
            }, 150);
        });
    }

    // Initial scroll to bottom on load
    setTimeout(() => {
        scrollChatToBottom();
    }, 500);
}

// Initialize mobile chat when DOM is ready
document.addEventListener('DOMContentLoaded', initMobileChat);

// ========================================
// 2. Game Switcher Logic
// ========================================
let currentGame = 'bingo';

function switchGame(game) {
    currentGame = game;

    // Update tab styling
    document.getElementById('bingo-tab').classList.toggle('active', game === 'bingo');
    document.getElementById('xoxo-tab').classList.toggle('active', game === 'xoxo');

    // Show/hide game areas
    document.getElementById('game-area').style.display = game === 'bingo' ? 'flex' : 'none';
    document.getElementById('xoxo-area').style.display = game === 'xoxo' ? 'flex' : 'none';
}

// ========================================
// 3. Chat Logic
// ========================================
function sendMessage() {
    const input = document.getElementById('msg-input');
    if (input.value.trim() !== "") {
        const msgData = { user: username, text: input.value.trim(), type: 'chat' };
        socket.emit('chat_message', msgData);
        input.value = "";
    }
}

document.getElementById('msg-input').addEventListener("keypress", function (event) {
    if (event.key === "Enter") sendMessage();
});

socket.on('chat_message', (data) => {
    const chatBox = document.getElementById('chat-messages');
    const chatArea = document.getElementById('chat-area');
    const msgDiv = document.createElement('div');

    msgDiv.classList.add('message');

    if (data.type === 'system') {
        msgDiv.classList.add('system');
        msgDiv.textContent = data.text;
    } else if (data.type === 'win') {
        msgDiv.classList.add('win');
        msgDiv.textContent = data.text;
    } else if (data.type === 'xoxo_result') {
        msgDiv.classList.add('xoxo_result');
        msgDiv.textContent = data.text;
    } else {
        msgDiv.classList.add(data.user === username ? 'mine' : 'theirs');
        // For others' messages, show username above message text
        if (data.user !== username) {
            msgDiv.innerHTML = `<strong>${escapeHtml(data.user)}</strong>${escapeHtml(data.text)}`;
        } else {
            msgDiv.textContent = data.text;
        }
    }

    chatBox.appendChild(msgDiv);

    // Auto-scroll to bottom - ensure new messages are always visible
    scrollChatToBottom(chatBox);
});

// Scroll chat to bottom with smooth behavior
function scrollChatToBottom(chatBox) {
    if (!chatBox) chatBox = document.getElementById('chat-messages');
    if (!chatBox) return;

    // Use requestAnimationFrame for reliable scroll after DOM update
    requestAnimationFrame(() => {
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// 4. XOXO (Tic-Tac-Toe) Game Logic
// ========================================

// Grid Size Selector
function setGridSize(size) {
    if (xoxoIsMultiplayer || xoxoIsSearching) {
        alert('Cannot change grid size during a game or while searching!');
        return;
    }

    selectedGridSize = size;

    // Update button states
    document.getElementById('grid-3x3-btn').classList.toggle('active', size === 3);
    document.getElementById('grid-5x5-btn').classList.toggle('active', size === 5);

    // Reinitialize grid with new size
    initXOXOGame(size);
}

function initXOXOGame(gridSize) {
    const size = gridSize || selectedGridSize;
    const totalCells = size * size;
    const grid = document.getElementById('xoxo-grid');
    grid.innerHTML = '';

    // Update grid class for styling
    grid.className = 'xoxo-grid'; // Reset classes
    grid.classList.add(`grid-${size}x${size}`);

    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.classList.add('xoxo-cell');
        cell.setAttribute('data-index', i);
        cell.setAttribute('tabindex', '0');
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', `Cell ${i + 1}`);

        cell.addEventListener('click', () => handleXOXOCellClick(i));
        cell.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleXOXOCellClick(i);
            }
        });

        grid.appendChild(cell);
    }

    // Reset to initial state
    resetXOXOLocalState(size);
    updateXOXOUI();
}

function resetXOXOLocalState(gridSize) {
    const size = gridSize || selectedGridSize;
    const totalCells = size * size;
    xoxoBoard = Array(totalCells).fill('');
    xoxoCurrentPlayer = 'X';
    xoxoGameActive = false;
    xoxoGameOver = false;
    xoxoRoomId = null;
    xoxoMySymbol = null;
    xoxoOpponentName = '';
    xoxoIsMultiplayer = false;
    xoxoIsSearching = false;
}

function updateXOXOUI() {
    const statusDiv = document.getElementById('xoxo-status');
    const resultDiv = document.getElementById('xoxo-result');
    const findMatchBtn = document.getElementById('xoxo-find-match');
    const newGameBtn = document.getElementById('xoxo-new-game');
    const leaveGameBtn = document.getElementById('xoxo-leave-game');
    const gameLockedOverlay = document.getElementById('xoxo-game-locked');

    // Clear result
    resultDiv.textContent = '';
    resultDiv.className = 'xoxo-result';

    // Hide overlay by default
    if (gameLockedOverlay) {
        gameLockedOverlay.style.display = 'none';
    }

    if (xoxoIsSearching) {
        statusDiv.textContent = '🔍 Searching for opponent...';
        statusDiv.style.color = '#f39c12';
        if (findMatchBtn) findMatchBtn.style.display = 'none';
        if (newGameBtn) newGameBtn.style.display = 'none';
        if (leaveGameBtn) leaveGameBtn.style.display = 'none';
    } else if (xoxoIsMultiplayer && xoxoRoomId) {
        if (xoxoGameOver) {
            // Game ended state
            if (leaveGameBtn) leaveGameBtn.style.display = 'inline-block';
            if (findMatchBtn) findMatchBtn.style.display = 'none';
            if (newGameBtn) newGameBtn.style.display = 'inline-block';
        } else {
            // Game in progress
            if (xoxoCurrentPlayer === xoxoMySymbol) {
                statusDiv.textContent = `🎯 Your Turn (${xoxoMySymbol})`;
                statusDiv.style.color = '#2ecc71';
            } else {
                statusDiv.textContent = `⏳ ${xoxoOpponentName}'s Turn (${xoxoCurrentPlayer})`;
                statusDiv.style.color = '#e67e22';
            }
            if (findMatchBtn) findMatchBtn.style.display = 'none';
            if (newGameBtn) newGameBtn.style.display = 'none';
            if (leaveGameBtn) leaveGameBtn.style.display = 'inline-block';
        }
    } else {
        // Not in a game
        statusDiv.textContent = 'Find an opponent to play!';
        statusDiv.style.color = 'rgba(255,255,255,0.9)';
        if (findMatchBtn) findMatchBtn.style.display = 'inline-block';
        if (newGameBtn) newGameBtn.style.display = 'none';
        if (leaveGameBtn) leaveGameBtn.style.display = 'none';
    }
}

function findXOXOMatch() {
    if (xoxoIsSearching || xoxoIsMultiplayer) return;

    xoxoIsSearching = true;
    socket.emit('xoxo_find_match', { gridSize: selectedGridSize });
    updateXOXOUI();
}

function cancelXOXOSearch() {
    if (!xoxoIsSearching) return;

    socket.emit('xoxo_cancel_search');
    xoxoIsSearching = false;
    updateXOXOUI();
}

function startNewXOXOGame() {
    if (xoxoIsMultiplayer && xoxoRoomId) {
        // Request rematch from server
        socket.emit('xoxo_new_game', { roomId: xoxoRoomId });
    } else {
        // Start searching for new match
        resetXOXOLocalState();
        clearXOXOBoard();
        updateXOXOUI();
        findXOXOMatch();
    }
}

function leaveXOXOGame() {
    if (xoxoRoomId) {
        socket.emit('xoxo_leave_game', { roomId: xoxoRoomId });
    }
    resetXOXOLocalState();
    clearXOXOBoard();
    updateXOXOUI();
}

function clearXOXOBoard() {
    const cells = document.querySelectorAll('.xoxo-cell');
    cells.forEach(cell => {
        cell.textContent = '';
        cell.className = 'xoxo-cell';
    });

    const gameGrid = document.getElementById('xoxo-grid');
    gameGrid.classList.remove('game-locked');

    const overlay = document.getElementById('xoxo-game-locked');
    if (overlay) overlay.style.display = 'none';
}

function handleXOXOCellClick(index) {
    // Multiplayer game logic
    if (!xoxoIsMultiplayer || !xoxoRoomId) {
        // Not in a multiplayer game - prompt to find match
        const statusDiv = document.getElementById('xoxo-status');
        statusDiv.textContent = 'Click "Find Match" to play!';
        statusDiv.style.color = '#f39c12';
        return;
    }

    if (xoxoGameOver) {
        return; // Game is locked
    }

    if (xoxoCurrentPlayer !== xoxoMySymbol) {
        // Not my turn
        const statusDiv = document.getElementById('xoxo-status');
        statusDiv.textContent = `⏳ Wait for ${xoxoOpponentName}'s move`;
        statusDiv.style.color = '#e74c3c';
        return;
    }

    if (xoxoBoard[index] !== '') {
        return; // Cell already taken
    }

    // Send move to server
    socket.emit('xoxo_move', {
        roomId: xoxoRoomId,
        cellIndex: index
    });
}

function renderXOXOBoard() {
    const cells = document.querySelectorAll('.xoxo-cell');
    cells.forEach((cell, index) => {
        const value = xoxoBoard[index];
        cell.textContent = value;
        cell.className = 'xoxo-cell';

        if (value !== '') {
            cell.classList.add('taken');
            cell.classList.add(value.toLowerCase());
        }
    });
}

function highlightWinningCells(pattern) {
    if (!pattern) return;

    pattern.forEach(index => {
        const cell = document.querySelector(`.xoxo-cell[data-index="${index}"]`);
        if (cell) {
            cell.classList.add('winning');
        }
    });
}

function lockXOXOGame(winnerSymbol, winnerInfo, loserInfo, pattern) {
    xoxoGameActive = false;
    xoxoGameOver = true;

    const statusDiv = document.getElementById('xoxo-status');
    const resultDiv = document.getElementById('xoxo-result');
    const gameGrid = document.getElementById('xoxo-grid');

    // Add locked class to grid
    gameGrid.classList.add('game-locked');

    // Disable all cells
    const cells = document.querySelectorAll('.xoxo-cell');
    cells.forEach(cell => {
        cell.classList.add('locked');
    });

    // Show game locked overlay
    let overlay = document.getElementById('xoxo-game-locked');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'xoxo-game-locked';
        overlay.className = 'game-locked-overlay';
        document.getElementById('xoxo-area').appendChild(overlay);
    }
    overlay.style.display = 'flex';

    // Display winner/loser messages
    if (winnerSymbol === 'draw') {
        statusDiv.textContent = "🤝 Game Over — It's a Draw!";
        statusDiv.style.color = '#f39c12';
        resultDiv.textContent = "🤝 It's a Draw!";
        resultDiv.className = 'xoxo-result draw';
        overlay.innerHTML = '<div class="overlay-content draw">🤝 DRAW</div>';
    } else {
        // Highlight winning row
        highlightWinningCells(pattern);

        const amIWinner = winnerInfo && (winnerInfo.socketId === socket.id);

        if (amIWinner) {
            // Winner screen
            statusDiv.textContent = `🎉 You Won!`;
            statusDiv.style.color = '#2ecc71';
            resultDiv.textContent = `🎉 You Won! Player ${winnerSymbol}`;
            resultDiv.className = 'xoxo-result win winner-self';
            overlay.innerHTML = `<div class="overlay-content winner">🎉 YOU WON!</div>`;
        } else {
            // Loser/Opponent screen
            const winnerName = winnerInfo ? winnerInfo.username : `Player ${winnerSymbol}`;
            statusDiv.textContent = `❌ Game Over — ${winnerName} Won`;
            statusDiv.style.color = '#e74c3c';
            resultDiv.textContent = `❌ You Lost. ${winnerName} Won`;
            resultDiv.className = 'xoxo-result win loser';
            overlay.innerHTML = `<div class="overlay-content loser">❌ YOU LOST<br><small>${winnerName} Won</small></div>`;
        }
    }

    updateXOXOUI();
}

// ========================================
// XOXO Socket Event Handlers
// ========================================

socket.on('xoxo_waiting', (data) => {
    const statusDiv = document.getElementById('xoxo-status');
    statusDiv.textContent = `🔍 ${data.message}`;
    statusDiv.style.color = '#f39c12';
});

socket.on('xoxo_search_cancelled', () => {
    xoxoIsSearching = false;
    updateXOXOUI();
});

socket.on('xoxo_already_in_game', (data) => {
    const statusDiv = document.getElementById('xoxo-status');
    statusDiv.textContent = '⚠️ You are already in a game!';
    statusDiv.style.color = '#e74c3c';
});

socket.on('xoxo_game_start', (data) => {
    xoxoIsSearching = false;
    xoxoIsMultiplayer = true;
    xoxoRoomId = data.roomId;
    xoxoBoard = data.board;
    xoxoCurrentPlayer = data.currentPlayer;
    xoxoGameActive = true;
    xoxoGameOver = false;

    // Update grid size from server (in case it differs)
    const serverGridSize = data.gridSize || 3;
    if (serverGridSize !== selectedGridSize) {
        selectedGridSize = serverGridSize;
        document.getElementById('grid-3x3-btn').classList.toggle('active', serverGridSize === 3);
        document.getElementById('grid-5x5-btn').classList.toggle('active', serverGridSize === 5);
    }

    // Determine my symbol and opponent
    if (data.players.X.socketId === socket.id) {
        xoxoMySymbol = 'X';
        xoxoOpponentName = data.players.O.username;
    } else {
        xoxoMySymbol = 'O';
        xoxoOpponentName = data.players.X.username;
    }

    // Reinitialize grid with correct size
    initXOXOGame(serverGridSize);
    renderXOXOBoard();
    updateXOXOUI();

    // Switch to XOXO tab if not already there
    if (currentGame !== 'xoxo') {
        switchGame('xoxo');
    }
});

socket.on('xoxo_state_update', (data) => {
    xoxoBoard = data.board;
    xoxoCurrentPlayer = data.currentPlayer;

    renderXOXOBoard();
    updateXOXOUI();
});

socket.on('xoxo_game_end', (data) => {
    xoxoBoard = data.board;
    renderXOXOBoard();

    lockXOXOGame(data.winner, data.winnerInfo, data.loserInfo, data.winningPattern);
});

socket.on('xoxo_game_restart', (data) => {
    xoxoBoard = data.board;
    xoxoCurrentPlayer = data.currentPlayer;
    xoxoGameActive = true;
    xoxoGameOver = false;

    // Reinitialize grid with correct size
    const serverGridSize = data.gridSize || selectedGridSize;
    initXOXOGame(serverGridSize);
    renderXOXOBoard();
    updateXOXOUI();
});

socket.on('xoxo_opponent_left', (data) => {
    const statusDiv = document.getElementById('xoxo-status');
    const resultDiv = document.getElementById('xoxo-result');

    xoxoGameActive = false;
    xoxoGameOver = true;

    statusDiv.textContent = `🚪 ${data.username} left the game`;
    statusDiv.style.color = '#e74c3c';
    resultDiv.textContent = `${data.username} left. You win by default! 🏆`;
    resultDiv.className = 'xoxo-result win';

    // Lock the game
    const gameGrid = document.getElementById('xoxo-grid');
    gameGrid.classList.add('game-locked');

    setTimeout(() => {
        resetXOXOLocalState();
        initXOXOGame(selectedGridSize);
        updateXOXOUI();
    }, 3000);
});

socket.on('xoxo_opponent_disconnected', (data) => {
    const statusDiv = document.getElementById('xoxo-status');
    const resultDiv = document.getElementById('xoxo-result');

    xoxoGameActive = false;
    xoxoGameOver = true;

    statusDiv.textContent = `📡 ${data.disconnectedPlayer} disconnected`;
    statusDiv.style.color = '#e74c3c';
    resultDiv.textContent = `${data.winner} wins by default! 🏆`;
    resultDiv.className = 'xoxo-result win';

    // Lock the game
    const gameGrid = document.getElementById('xoxo-grid');
    gameGrid.classList.add('game-locked');

    setTimeout(() => {
        resetXOXOLocalState();
        clearXOXOBoard();
        updateXOXOUI();
    }, 3000);
});

socket.on('xoxo_invalid_move', (data) => {
    const statusDiv = document.getElementById('xoxo-status');
    statusDiv.textContent = `⚠️ ${data.message}`;
    statusDiv.style.color = '#e74c3c';

    setTimeout(() => {
        updateXOXOUI();
    }, 1500);
});

socket.on('xoxo_result_payload', (data) => {
    // This can be used for external integrations
    console.log('XOXO Result Payload:', data);
    // Example: send to analytics, save to database, etc.
});

// ========================================
// 5. Bingo Logic
// ========================================
// Add B-I-N-G-O header row
function addBingoHeaders(gridElement) {
    const letters = ['B', 'I', 'N', 'G', 'O'];
    letters.forEach((letter, index) => {
        const header = document.createElement('div');
        header.classList.add('header-cell');
        header.textContent = letter;
        header.setAttribute('data-letter-index', index);
        gridElement.appendChild(header);
    });
}

function createEmptyBoard() {
    const grid = document.getElementById('bingo-grid');
    grid.innerHTML = "";

    addBingoHeaders(grid);

    board = [];
    marked = [];
    completedLines = [];
    isGameActive = false;
    document.getElementById('bingo-btn').style.display = 'none';
    document.getElementById('game-status').textContent = "Enter numbers 1-25 uniquely or use Random Board.";

    // Create 25 input cells for manual entry with improved UX
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');

        const input = document.createElement('input');
        input.type = "text";
        input.inputMode = "numeric";
        input.pattern = "[0-9]*";
        input.maxLength = 2;
        input.setAttribute('aria-label', `Cell ${i + 1} number input`);
        input.setAttribute('data-cell-index', i);

        // Improved input handling
        input.addEventListener('input', function (e) {
            let val = this.value.replace(/[^0-9]/g, '');

            if (val === "") {
                this.value = "";
                return;
            }

            let num = parseInt(val, 10);
            if (num > 25) num = 25;
            if (num < 1 && val.length >= 1) num = 1;

            this.value = num || "";

            // Auto-focus next cell when valid number entered
            if (this.value.length > 0 && num >= 1 && num <= 25) {
                const nextIndex = i + 1;
                if (nextIndex < 25) {
                    const nextInput = document.querySelector(`input[data-cell-index="${nextIndex}"]`);
                    if (nextInput && nextInput.value === "") {
                        setTimeout(() => nextInput.focus(), 50);
                    }
                }
            }
        });

        // Allow backspace to go to previous cell
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && this.value === '' && i > 0) {
                const prevInput = document.querySelector(`input[data-cell-index="${i - 1}"]`);
                if (prevInput) {
                    prevInput.focus();
                    prevInput.select();
                }
            }
        });

        // Select all on focus for easy replacement
        input.addEventListener('focus', function () {
            this.select();
        });

        cell.appendChild(input);
        grid.appendChild(cell);
    }

    // Focus first input
    setTimeout(() => {
        const firstInput = document.querySelector('input[data-cell-index="0"]');
        if (firstInput) firstInput.focus();
    }, 100);
}

// generate random unique numbers 1..25
function generateRandomBoard() {
    let numbers = [];
    while (numbers.length < 25) {
        const r = Math.floor(Math.random() * 25) + 1;
        if (!numbers.includes(r)) numbers.push(r);
    }
    renderPlayableBoard(numbers);
}

// confirm manual board, validate uniqueness
function confirmManualBoard() {
    const inputs = document.querySelectorAll('.cell input');
    let values = [];
    let seen = new Set();

    for (let i = 0; i < inputs.length; i++) {
        let input = inputs[i];
        let val = parseInt(input.value, 10);

        if (isNaN(val) || input.value.trim() === "") {
            input.focus();
            input.style.border = "2px solid red";
            setTimeout(() => input.style.border = "", 1000);
            return alert(`Please fill cell ${i + 1} with a number.`);
        }

        if (val < 1 || val > 25) {
            input.focus();
            input.style.border = "2px solid red";
            setTimeout(() => input.style.border = "", 1000);
            return alert(`Invalid number in cell ${i + 1}: ${val}. Use 1-25 only.`);
        }

        if (seen.has(val)) {
            input.focus();
            input.style.border = "2px solid red";
            setTimeout(() => input.style.border = "", 1000);
            return alert(`Duplicate number found: ${val}. Each number must be unique!`);
        }

        seen.add(val);
        values.push(val);
    }
    renderPlayableBoard(values);
}

function renderPlayableBoard(numbers) {
    const grid = document.getElementById('bingo-grid');
    grid.innerHTML = "";

    addBingoHeaders(grid);

    board = numbers.slice();
    marked = new Array(25).fill(false);
    completedLines = [];
    isGameActive = true;

    document.getElementById('start-manual-btn').style.display = 'none';
    document.getElementById('bingo-btn').style.display = 'none';
    document.getElementById('game-status').textContent = "Game On! Mark numbers. Complete lines light up BINGO letters!";

    numbers.forEach((num, idx) => {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.textContent = num;
        cell.setAttribute('data-index', idx);
        cell.tabIndex = 0;
        cell.onclick = () => toggleCell(cell);
        cell.onkeypress = (e) => { if (e.key === 'Enter' || e.key === ' ') toggleCell(cell); };
        grid.appendChild(cell);
    });

    // after rendering, ensure the grid is visible (scroll to it)
    const container = document.getElementById('game-area');
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// reset board to inputs
function resetBoard() {
    createEmptyBoard();
}

function toggleCell(cell) {
    if (!isGameActive) return;
    const idx = parseInt(cell.getAttribute('data-index'), 10);
    if (Number.isNaN(idx)) return;

    marked[idx] = !marked[idx];
    cell.classList.toggle('marked', marked[idx]);

    // check and update BINGO letters
    updateBingoLetters();
}

// Update BINGO letter highlighting based on completed lines
function updateBingoLetters() {
    const lines = getAllCompletedLines();
    completedLines = lines;

    // Clear all active states
    const headers = document.querySelectorAll('.header-cell');
    headers.forEach(h => h.classList.remove('active'));

    // Light up letters based on number of completed lines
    const numComplete = lines.length;
    for (let i = 0; i < Math.min(numComplete, 5); i++) {
        const header = document.querySelector(`.header-cell[data-letter-index="${i}"]`);
        if (header) {
            header.classList.add('active');
        }
    }

    // Check if all 5 letters are lit (5 lines complete)
    if (numComplete >= 5) {
        // Auto-declare BINGO!
        setTimeout(() => {
            autoDeclareWin();
        }, 500);
    }
}

// Get all completed lines (rows, columns, diagonals)
function getAllCompletedLines() {
    if (!isGameActive || !marked || marked.length !== 25) return [];

    const lines = [];

    // Check rows (0-4)
    for (let r = 0; r < 5; r++) {
        let complete = true;
        for (let c = 0; c < 5; c++) {
            if (!marked[r * 5 + c]) {
                complete = false;
                break;
            }
        }
        if (complete) lines.push(`row${r}`);
    }

    // Check columns (5-9)
    for (let c = 0; c < 5; c++) {
        let complete = true;
        for (let r = 0; r < 5; r++) {
            if (!marked[r * 5 + c]) {
                complete = false;
                break;
            }
        }
        if (complete) lines.push(`col${c}`);
    }

    // Check diagonal top-left -> bottom-right (10)
    const diag1 = [0, 6, 12, 18, 24];
    if (diag1.every(i => marked[i])) {
        lines.push('diag1');
    }

    // Check diagonal top-right -> bottom-left (11)
    const diag2 = [4, 8, 12, 16, 20];
    if (diag2.every(i => marked[i])) {
        lines.push('diag2');
    }

    return lines;
}

// check for any complete row/column/diagonal (legacy - still used for manual button)
function checkForBingo() {
    return getAllCompletedLines().length >= 5;
}

function autoDeclareWin() {
    if (!isGameActive) return;

    socket.emit('bingo_win', username);
    document.getElementById('game-status').textContent = `🎉 ${username} got BINGO!`;
    isGameActive = false;
    document.getElementById('bingo-btn').style.display = 'none';
    // Track Bingo win
    incrementStat('bingo', 'wins');
}

function declareWin() {
    if (!isGameActive) return alert("Game is not active.");
    const hasBingo = checkForBingo();
    if (!hasBingo) {
        return alert("You need 5 complete lines to declare BINGO!");
    }
    socket.emit('bingo_win', username);
    document.getElementById('game-status').textContent = `🎉 ${username} declared Bingo!`;
    isGameActive = false;
    document.getElementById('bingo-btn').style.display = 'none';
    // Track Bingo win
    incrementStat('bingo', 'wins');
}