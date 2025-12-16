const socket = io();
let username = "";
let board = []; // Stores the 5x5 grid values

// --- 1. Login Logic ---
function joinGame() {
    const input = document.getElementById('username-input');
    if (input.value.trim() === "") return alert("Please enter a name!");
    
    username = input.value;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    
    socket.emit('join', username);
    createEmptyBoard(); // Start with editable board
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

// Allow pressing "Enter" to send
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
        // Normal Chat
        msgDiv.classList.add(data.user === username ? 'mine' : 'theirs');
        msgDiv.innerHTML = `<strong>${data.user}:</strong> ${data.text}`;
    }
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto scroll to bottom
});

// --- 3. Bingo Game Logic ---

// Create an empty grid where users can type numbers manually
function createEmptyBoard() {
    const grid = document.getElementById('bingo-grid');
    grid.innerHTML = "";
    board = [];

    // Loop 25 times for a pure 5x5 grid (No Free Space)
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.index = i;

        // Create input for every cell, including the center
        const input = document.createElement('input');
        input.type = "number";
        input.placeholder = "-";
        input.min = 1;
        input.max = 25;
        cell.appendChild(input);
        
        grid.appendChild(cell);
    }
}

// Generate Random Board (1-25 Only, No Free Space)
function generateRandomBoard() {
    const grid = document.getElementById('bingo-grid');
    grid.innerHTML = "";
    board = [];
    
    // Generate a shuffled list of numbers 1-25
    let numbers = [];
    while(numbers.length < 25){
        let r = Math.floor(Math.random() * 25) + 1;
        if(numbers.indexOf(r) === -1) numbers.push(r);
    }

    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        
        // Just assign the number to the cell (No Free Space check)
        cell.textContent = numbers[i];
        board.push(numbers[i]);
        
        // Click to toggle mark
        cell.onclick = () => toggleCell(cell);
        
        grid.appendChild(cell);
    }
}

function resetBoard() {
    createEmptyBoard();
}

function toggleCell(cell) {
    cell.classList.toggle('marked');
}

function declareWin() {
    socket.emit('bingo_win', username);
}