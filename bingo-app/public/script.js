const socket = io();
let username = "";
let board = [];        // numbers array length 25
let marked = [];       // boolean array length 25
let isGameActive = false;

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
    letters.forEach(letter => {
        const header = document.createElement('div');
        header.classList.add('header-cell');
        header.textContent = letter;
        header.onclick = function() {
            this.classList.toggle('active');
        };
        gridElement.appendChild(header);
    });
}

function createEmptyBoard() {
    const grid = document.getElementById('bingo-grid');
    grid.innerHTML = "";

    addBingoHeaders(grid);

    board = [];
    marked = [];
    isGameActive = false;
    document.getElementById('bingo-btn').style.display = 'none';
    document.getElementById('start-manual-btn').style.display = 'inline-block';
    document.getElementById('game-status').textContent = "Enter numbers 1-25 uniquely.";

    // Create 25 input cells for manual entry
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');

        const input = document.createElement('input');
        input.type = "number";
        input.min = 1;
        input.max = 25;
        input.setAttribute('aria-label', `Cell ${i+1} number input`);

        // Strict input enforcement
        input.addEventListener('input', function() {
            if (this.value === "") return;
            let v = parseInt(this.value, 10);
            if (isNaN(v)) { this.value = ""; return; }
            if (v > 25) this.value = 25;
            if (v < 1) this.value = 1;
        });

        cell.appendChild(input);
        grid.appendChild(cell);
    }
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

    for (let input of inputs) {
        let val = parseInt(input.value, 10);
        if (isNaN(val)) return alert("Please fill all cells with numbers.");
        if (val < 1 || val > 25) return alert(`Invalid number: ${val}. Use 1-25.`);
        if (seen.has(val)) return alert(`Duplicate found: ${val}. Each number must be unique.`);
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
    isGameActive = true;

    document.getElementById('start-manual-btn').style.display = 'none';
    document.getElementById('bingo-btn').style.display = 'none';
    document.getElementById('game-status').textContent = "Game On! Click numbers to mark. When a 5-in-a-row is complete the Bingo button appears.";

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

    // check bingo after every toggle
    const hasBingo = checkForBingo();
    document.getElementById('bingo-btn').style.display = hasBingo ? 'block' : 'none';
}

// check for any complete row/column/diagonal
function checkForBingo() {
    if (!isGameActive || !marked || marked.length !== 25) return false;

    // rows
    for (let r = 0; r < 5; r++) {
        let ok = true;
        for (let c = 0; c < 5; c++) {
            if (!marked[r * 5 + c]) { ok = false; break; }
        }
        if (ok) return true;
    }

    // columns
    for (let c = 0; c < 5; c++) {
        let ok = true;
        for (let r = 0; r < 5; r++) {
            if (!marked[r * 5 + c]) { ok = false; break; }
        }
        if (ok) return true;
    }

    // diagonal top-left -> bottom-right
    const diag1 = [0, 6, 12, 18, 24];
    if (diag1.every(i => marked[i])) return true;

    // diagonal top-right -> bottom-left
    const diag2 = [4, 8, 12, 16, 20];
    if (diag2.every(i => marked[i])) return true;

    return false;
}

function declareWin() {
    if (!isGameActive) return alert("Game is not active.");
    const hasBingo = checkForBingo();
    if (!hasBingo) {
        return alert("No valid Bingo yet. Complete any 5-in-a-row (row, column, or diagonal) to enable the Bingo button.");
    }
    socket.emit('bingo_win', username);
    // optional: announce locally
    document.getElementById('game-status').textContent = `🎉 ${username} declared Bingo!`;
    // disable further marking to avoid duplicate wins (optional)
    isGameActive = false;
    document.getElementById('bingo-btn').style.display = 'none';
}

// When server broadcasts a bingo win message it already produces a 'win' type and we display that in chat.
// Additional client behavior could be added here if needed.
