// server.js

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path'); // <<< 1. IMPORT THE PATH MODULE

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

let gameRooms = {};
let loadedQuestions = [];

// --- Google Sheets Setup ---
async function loadQuestionsFromSheet() {
    console.log('Authenticating with Google Sheets...');

    // This tells Node.js to go UP one directory from server.js (out of 'src')
    // and then find the credentials file. It's the most reliable way.
    const credentialsPath = path.join(__dirname, '..', 'google-credentials.json');

    const auth = new GoogleAuth({
        // <<< 2. USE THE NEW, CORRECT PATH
        keyFile: credentialsPath, 
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);

    try {
        await doc.loadInfo();
        console.log(`Connected to sheet: ${doc.title}`);
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();

        if (rows.length === 0) {
            console.error("Sheet is empty! Please add questions.");
            return;
        }

        loadedQuestions = rows.map(row => {
            const rowData = row.toObject();
            const answers = [];
            for (let i = 1; i <= 6; i++) {
                if (rowData[`answer_${i}`] && rowData[`stat_${i}`]) {
                    answers.push({
                        text: rowData[`answer_${i}`],
                        rank: i,
                        stat: rowData[`stat_${i}`],
                    });
                }
            }
            return {
                question: rowData.question,
                answers: answers
            };
        }).filter(q => q.question && q.answers.length === 6);

        console.log(`Successfully loaded ${loadedQuestions.length} questions from the Google Sheet.`);

    } catch (error) {
        console.error('Error loading Google Sheet:', error);
        console.error('CRITICAL: Failed to load questions. The server cannot start without them.');
        console.error('Check: 1) Sheet ID is correct. 2) Sheet is shared with the service account email. 3) Google Sheets API is enabled.');
        process.exit(1);
    }
}


// --- Function to get a question from our cache ---
function getQuestionFromCache(questionHistory = []) {
    if (loadedQuestions.length === 0) {
        console.error("No questions are loaded in the cache.");
        return null;
    }
    const availableQuestions = loadedQuestions.filter(q => !questionHistory.includes(q.question));
    if (availableQuestions.length === 0) {
        console.warn("All unique questions have been used. Reusing questions.");
        const randomIndex = Math.floor(Math.random() * loadedQuestions.length);
        return JSON.parse(JSON.stringify(loadedQuestions[randomIndex]));
    }
    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    return JSON.parse(JSON.stringify(availableQuestions[randomIndex]));
}

// --- Helper Functions ---
function generateRoomCode() {
    let code = '';
    const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (gameRooms[code]) return generateRoomCode();
    return code;
}

function createNewGameState() {
    return {
        phase: 'LOBBY', players: {}, hostId: null, unassignedPlayerIds: [],
        teams: {
            teamA: { id: 'teamA', name: 'Team A', score: 0, players: [] },
            teamB: { id: 'teamB', name: 'Team B', score: 0, players: [] },
        },
        round: 1, currentTurnTeamId: null, turnData: null,
        bonusData: null, postGameData: null, questionHistory: [], 
    };
}

async function startNewTurnForTeam(roomCode, teamId) {
    const room = gameRooms[roomCode];
    if (!room || !room.teams[teamId]) return;
    const team = room.teams[teamId];
    const pickerIndex = room.round === 1 ? 0 : 1;
    const deciderIndex = room.round === 1 ? 1 : 0;
    if (team.players.length < 2) return;

    const questionData = getQuestionFromCache(room.questionHistory);
    if (!questionData) {
        io.to(roomCode).emit('error', { message: "Could not load a question. Please check server logs."});
        return;
    }
    
    room.questionHistory.push(questionData.question);
    if (room.questionHistory.length > 10) room.questionHistory.shift();
    
    room.phase = 'IN_GAME';
    room.currentTurnTeamId = teamId;
    room.turnData = {
        question: questionData.question,
        correctlyRankedAnswers: questionData.answers.sort((a, b) => a.rank - b.rank),
        boardAnswers: [...questionData.answers].sort(() => Math.random() - 0.5).map(a => a.text),
        decisionBox: [], heldAnswer: null, turnPhase: 'PICKING_TWO',
        picker: team.players[pickerIndex], decider: team.players[deciderIndex],
        message: `Round ${room.round} - ${team.name}'s Turn. Waiting for ${team.players[pickerIndex].username} (Picker).`,
    };
    io.to(roomCode).emit('gameStateUpdate', room);
}

function handleRevealPhase(roomCode) {
    const room = gameRooms[roomCode];
    if (!room || !room.turnData) return;
    room.phase = 'REVEAL';
    room.turnData.decisionBox = [];
    room.turnData.message = `Round ${room.round} complete! The correct order is shown above.`;
    io.to(roomCode).emit('gameStateUpdate', room);
    setTimeout(() => {
        if (room.currentTurnTeamId === 'teamA') {
            startNewTurnForTeam(roomCode, 'teamB');
        } else {
            room.round += 1;
            if (room.round > 2) endMainGame(roomCode);
            else startNewTurnForTeam(roomCode, 'teamA');
        }
    }, 7000);
}

function endMainGame(roomCode) {
    const room = gameRooms[roomCode];
    if (!room) return;
    room.phase = 'GAME_OVER';
    const { teamA, teamB } = room.teams;
    let winner = teamA.score > teamB.score ? teamA : (teamB.score > teamA.score ? teamB : teamA);
    room.winner = winner;
    if (room.turnData) {
        room.turnData.message = `Game Over! ${winner.name} wins! Preparing for their Bonus Round...`;
    }
    io.to(roomCode).emit('gameStateUpdate', room);
    setTimeout(() => startBonusRound(roomCode, winner), 5000);
}

async function startBonusRound(roomCode, winningTeam) {
    const room = gameRooms[roomCode];
    if (!room) return;
    console.log(`Starting Bonus Round for ${winningTeam.name} in room ${roomCode}`);
    room.phase = 'BONUS_ROUND';

    const questionData = getQuestionFromCache(room.questionHistory);
    if (!questionData) {
        io.to(roomCode).emit('error', { message: "Could not load a question for the bonus round."});
        return;
    }
    const sortedAnswers = questionData.answers.sort((a, b) => a.rank - b.rank);

    room.bonusData = {
        question: questionData.question,
        instructions: "Avoid picking the highest-ranked remaining answer. Get 4 correct to win!",
        fullAnswers: sortedAnswers, boardAnswers: [...sortedAnswers].map(a => a.text),
        revealedAnswers: [], winningTeam: winningTeam, currentPickerIndex: 0,
        bonusWinnings: 0, strikes: 0, isOver: false,
        message: `BONUS ROUND! ${winningTeam.players[0].username}, pick an answer.`,
    };
    io.to(roomCode).emit('gameStateUpdate', room);
}

function handleBonusRoundEnd(roomCode, wasBonusWon) {
    const room = gameRooms[roomCode];
    if (!room || !room.bonusData) return;
    const bonus = room.bonusData;
    if (!wasBonusWon) bonus.bonusWinnings = 0;
    room.phase = 'POST_GAME';
    room.postGameData = {
        winningTeam: bonus.winningTeam, wasBonusWon: wasBonusWon,
        bonusWinnings: bonus.bonusWinnings, correctBonusOrder: bonus.fullAnswers,
    };
    delete room.bonusData; delete room.turnData;
    io.to(roomCode).emit('gameStateUpdate', room);
}

// --- Socket.IO Connection and Event Handlers ---
io.on('connection', (socket) => {
    socket.on('createGame', ({ username }) => {
        const roomCode = generateRoomCode();
        socket.join(roomCode); socket.roomCode = roomCode;
        const room = createNewGameState();
        gameRooms[roomCode] = room;
        room.hostId = socket.id;
        room.players[socket.id] = { id: socket.id, username: username || `Player 1` };
        room.unassignedPlayerIds.push(socket.id);
        socket.emit('gameCreated', { roomCode });
        io.to(roomCode).emit('gameStateUpdate', room);
    });

    socket.on('joinGame', ({ roomCode, username }) => {
        roomCode = roomCode.toUpperCase();
        const room = gameRooms[roomCode];
        if (!room) return socket.emit('error', { message: 'Room not found.' });
        if (Object.keys(room.players).length >= 4) return socket.emit('error', { message: 'Room is full.' });
        socket.join(roomCode); socket.roomCode = roomCode;
        room.players[socket.id] = { id: socket.id, username: username || `Player ${Object.keys(room.players).length + 1}` };
        room.unassignedPlayerIds.push(socket.id);
        socket.emit('joinSuccess', { roomCode });
        io.to(roomCode).emit('gameStateUpdate', room);
    });
    
    socket.on('joinTeam', ({ roomCode, teamId }) => {
        const room = gameRooms[roomCode];
        if (!room) return;
        const player = room.players[socket.id];
        const team = room.teams[teamId];
        if (!player || !team || !room.unassignedPlayerIds.includes(socket.id)) return;
        if (team.players.length >= 2) return socket.emit('error', { message: `Team ${team.name} is full.` });
        room.unassignedPlayerIds = room.unassignedPlayerIds.filter(id => id !== socket.id);
        team.players.push(player);
        io.to(roomCode).emit('gameStateUpdate', room);
    });

    socket.on('startGame', ({ roomCode }) => {
        const room = gameRooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        if (room.teams.teamA.players.length !== 2 || room.teams.teamB.players.length !== 2) {
            return socket.emit('error', { message: 'Both teams must have 2 players to start.' });
        }
        startNewTurnForTeam(roomCode, 'teamA');
    });

    socket.on('playAgain', ({ roomCode }) => {
        const room = gameRooms[roomCode];
        if (!room) return;
        const players = { ...room.players };
        const hostId = room.hostId;
        const newRoomState = createNewGameState();
        gameRooms[roomCode] = newRoomState;
        newRoomState.players = players;
        newRoomState.hostId = hostId;
        newRoomState.unassignedPlayerIds = Object.keys(players);
        io.to(roomCode).emit('gameStateUpdate', newRoomState);
    });

    socket.on('playerAction', ({ roomCode, payload }) => {
        const room = gameRooms[roomCode];
        if (!room) return;
        const playerId = socket.id;

        if (room.phase === 'IN_GAME' && room.turnData) {
            const turn = room.turnData;
            const isPicker = playerId === turn.picker?.id;
            const isDecider = playerId === turn.decider?.id;

            if ((turn.turnPhase === 'PICKING_TWO' || turn.turnPhase === 'PICKING_ONE') && isPicker) {
                const answer = payload;
                if (turn.boardAnswers.includes(answer)) {
                    turn.decisionBox.push(answer);
                    turn.boardAnswers = turn.boardAnswers.filter(a => a !== answer);
                    if (turn.decisionBox.length === 2) {
                        turn.turnPhase = 'DECIDING';
                        turn.message = `Waiting for ${turn.decider.username} (Decider) to choose the higher-ranked answer.`;
                    }
                }
            } else if (turn.turnPhase === 'DECIDING' && isDecider) {
                const choice = payload;
                const otherChoice = turn.decisionBox.find(a => a !== choice);
                if (!otherChoice) return;
                const choiceRank = turn.correctlyRankedAnswers.findIndex(a => a.text === choice);
                const otherChoiceRank = turn.correctlyRankedAnswers.findIndex(a => a.text === otherChoice);
                const points = room.round === 1 ? 1 : 2;
                let msg;
                if (choiceRank < otherChoiceRank) {
                    room.teams[room.currentTurnTeamId].score += points;
                    msg = `Correct! "${choice}" is higher. (+${points} pts)`;
                } else {
                    msg = `Incorrect. "${otherChoice}" was higher. No points.`;
                }
                turn.heldAnswer = choice;
                if (turn.boardAnswers.length === 0) {
                    handleRevealPhase(roomCode);
                } else {
                    turn.decisionBox = [turn.heldAnswer];
                    turn.turnPhase = 'PICKING_ONE';
                    turn.message = `${msg} Now, ${turn.picker.username} must pick one to compare.`;
                }
            }
        }
        else if (room.phase === 'BONUS_ROUND' && room.bonusData && !room.bonusData.isOver) {
            const bonus = room.bonusData;
            const currentPicker = bonus.winningTeam.players[bonus.currentPickerIndex];
            if (playerId !== currentPicker.id) return;
            const pickedAnswerText = payload;
            if (!bonus.boardAnswers.includes(pickedAnswerText)) return;
            const topRemainingAnswer = bonus.fullAnswers.filter(answer => bonus.boardAnswers.includes(answer.text)).sort((a, b) => a.rank - b.rank)[0];
            const pickedAnswerObject = bonus.fullAnswers.find(a => a.text === pickedAnswerText);
            bonus.boardAnswers = bonus.boardAnswers.filter(a => a !== pickedAnswerText);
            if (pickedAnswerText === topRemainingAnswer.text) {
                bonus.strikes++;
                bonus.revealedAnswers.push({ ...pickedAnswerObject, isStrike: true });
                if (bonus.strikes >= 2) {
                    bonus.isOver = true;
                    bonus.message = `That's two strikes! The bonus round is over.`;
                    handleBonusRoundEnd(roomCode, false);
                } else {
                    bonus.currentPickerIndex = (bonus.currentPickerIndex + 1) % 2;
                    const nextPicker = bonus.winningTeam.players[bonus.currentPickerIndex];
                    bonus.message = `STRIKE! It's now ${nextPicker.username}'s turn.`;
                }
            } else {
                bonus.bonusWinnings += 500;
                bonus.revealedAnswers.push(pickedAnswerObject);
                const correctPicksCount = bonus.revealedAnswers.filter(a => !a.isStrike).length;
                if (correctPicksCount >= 4) {
                    bonus.isOver = true;
                    bonus.message = `That's 4 correct answers! You've won the bonus round!`;
                    handleBonusRoundEnd(roomCode, true);
                } else {
                    bonus.currentPickerIndex = (bonus.currentPickerIndex + 1) % 2;
                    const nextPicker = bonus.winningTeam.players[bonus.currentPickerIndex];
                    bonus.message = `Correct! +$500! Total: $${bonus.bonusWinnings}. It's ${nextPicker.username}'s turn.`;
                }
            }
        }
        io.to(roomCode).emit('gameStateUpdate', room);
    });
    
    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (roomCode && gameRooms[roomCode]) {
            const room = gameRooms[roomCode];
            const playerId = socket.id;
            delete room.players[playerId];
            room.unassignedPlayerIds = room.unassignedPlayerIds.filter(id => id !== playerId);
            room.teams.teamA.players = room.teams.teamA.players.filter(p => p.id !== playerId);
            room.teams.teamB.players = room.teams.teamB.players.filter(p => p.id !== playerId);
            if (Object.keys(room.players).length === 0) {
                delete gameRooms[roomCode];
            } else {
                if (playerId === room.hostId) {
                    io.to(roomCode).emit('error', { message: 'The host has disconnected. The game has ended.' });
                    delete gameRooms[roomCode];
                    return;
                }
                if (room.phase !== 'LOBBY' && room.phase !== 'POST_GAME') {
                    const players = { ...room.players };
                    const hostId = room.hostId;
                    const newRoomState = createNewGameState();
                    gameRooms[roomCode] = newRoomState;
                    newRoomState.players = players;
                    newRoomState.hostId = hostId;
                    newRoomState.unassignedPlayerIds = Object.keys(players);
                    io.to(roomCode).emit('gameStateUpdate', newRoomState);
                } else {
                    io.to(roomCode).emit('gameStateUpdate', room);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    loadQuestionsFromSheet();
});