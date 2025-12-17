const socket = io();
let username = "";
let board = [];
let isGameActive = false;

// --- 1. Login Logic ---
function joinGame() {
    const input = document.getElementById('username-input');
    if (input.value.trim() === "") return alert("Please enter a name!");
    
    username = input.value;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    
    socket.emit('join', username);
    createEmptyBoard(); 
}

// --- 2. Chat Logic ---
function sendMessage() {
    const input = document.getElementById('msg-input');
    if (input.value.trim() !== "") {
        const msgData = { user: username, text: input.value, type: 'chat' };
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
        msgDiv.innerHTML = `<strong>${data.user}:</strong> ${data.text}`;
    }
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight; 
});

// --- 3. Strict Bingo Logic ---

// Helper: Adds the B-I-N-G-O header row
function addBingoHeaders(gridElement) {
    const letters = ['B', 'I', 'N', 'G', 'O'];
    letters.forEach(letter => {
        const header = document.createElement('div');
        header.classList.add('header-cell');
        header.textContent = letter;
        gridElement.appendChild(header);
    });
}

function createEmptyBoard() {
    const grid = document.getElementById('bingo-grid');
    grid.innerHTML = "";
    
    // Insert B-I-N-G-O Headers first
    addBingoHeaders(grid);

    board = [];
    isGameActive = false;
    document.getElementById('bingo-btn').style.display = 'none';
    document.getElementById('start-manual-btn').style.display = 'inline-block';
    document.getElementById('game-status').textContent = "Enter numbers 1-25 uniquely.";

    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        
        const input = document.createElement('input');
        input.type = "number";
        input.min = 1;
        input.max = 25;
        
        // STRICT INPUT: Prevent typing non-numbers or > 25 immediately
        input.addEventListener('input', function() {
            if (this.value > 25) this.value = 25;
            if (this.value < 1 && this.value !== "") this.value = 1;
        });

        cell.appendChild(input);
        grid.appendChild(cell);
    }
}

function generateRandomBoard() {
    // Generate unique numbers first
    let numbers = [];
    while(numbers.length < 25){
        let r = Math.floor(Math.random() * 25) + 1;
        if(!numbers.includes(r)) numbers.push(r);
    }
    renderPlayableBoard(numbers);
}

function confirmManualBoard() {
    const inputs = document.querySelectorAll('.cell input');
    let values = [];
    let seen = new Set();

    for (let input of inputs) {
        let val = parseInt(input.value);

        if (isNaN(val)) return alert("Please fill all cells with numbers.");
        if (val < 1 || val > 25) return alert(`Invalid number: ${val}. Strictly use 1-25.`);
        if (seen.has(val)) return alert(`Duplicate found: ${val}. Each number must be unique.`);
        
        seen.add(val);
        values.push(val);
    }

    renderPlayableBoard(values);
}

function renderPlayableBoard(numbers) {
    const grid = document.getElementById('bingo-grid');
    grid.innerHTML = "";
    
    // Insert B-I-N-G-O Headers first
    addBingoHeaders(grid);

    board = numbers;
    isGameActive = true;

    document.getElementById('start-manual-btn').style.display = 'none';
    document.getElementById('bingo-btn').style.display = 'block';
    document.getElementById('game-status').textContent = "Game On! Click to mark numbers.";

    numbers.forEach(num => {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.textContent = num;
        cell.onclick = () => toggleCell(cell);
        grid.appendChild(cell);
    });
}

function resetBoard() {
    createEmptyBoard();
}

function toggleCell(cell) {
    if(!isGameActive) return;
    cell.classList.toggle('marked');
}

function declareWin() {
    if(!isGameActive) return;
    socket.emit('bingo_win', username);
}