const socket = io();
let username = "";
let board = [];        // numbers array length 25
let marked = [];       // boolean array length 25
let isGameActive = false;
let completedLines = []; // track which lines (rows/cols/diags) are complete

// --- 1. Login Logic ---
function joinGame() {
    const input = document.getElementById('username-input');
    if (input.value.trim() === "") return alert("Please enter a name!");

    username = input.value.trim();
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';

    socket.emit('join', username);
    createEmptyBoard();
}

// --- 2. Chat Logic ---
function sendMessage() {
    const input = document.getElementById('msg-input');
    if (input.value.trim() !== "") {
        const msgData = { user: username, text: input.value.trim(), type: 'chat' };
        socket.emit('chat_message', msgData);
        input.value = "";
    }
}

document.getElementById('msg-input').addEventListener("keypress", function(event) {
    if (event.key === "Enter") sendMessage();
});

socket.on('chat_message', (data) => {
    const chatBox = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');

    msgDiv.classList.add('message');

    if (data.type === 'system') {
        msgDiv.classList.add('system');
        msgDiv.textContent = data.text;
    } else if (data.type === 'win') {
        msgDiv.classList.add('win');
        msgDiv.textContent = data.text;
    } else {
        msgDiv.classList.add(data.user === username ? 'mine' : 'theirs');
        msgDiv.innerHTML = `<strong>${escapeHtml(data.user)}:</strong> ${escapeHtml(data.text)}`;
    }

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// very small helper to avoid injecting markup into chat
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- 3. Bingo Logic ---
// Add B-I-N-G-O header row
function addBingoHeaders(gridElement) {
    const letters = ['B','I','N','G','O'];
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
    document.getElementById('start-manual-btn').style.display = 'inline-block';
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
        input.setAttribute('aria-label', `Cell ${i+1} number input`);
        input.setAttribute('data-cell-index', i);

        // Improved input handling
        input.addEventListener('input', function(e) {
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
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && this.value === '' && i > 0) {
                const prevInput = document.querySelector(`input[data-cell-index="${i-1}"]`);
                if (prevInput) {
                    prevInput.focus();
                    prevInput.select();
                }
            }
        });

        // Select all on focus for easy replacement
        input.addEventListener('focus', function() {
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
            return alert(`Please fill cell ${i+1} with a number.`);
        }
        
        if (val < 1 || val > 25) {
            input.focus();
            input.style.border = "2px solid red";
            setTimeout(() => input.style.border = "", 1000);
            return alert(`Invalid number in cell ${i+1}: ${val}. Use 1-25 only.`);
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
}