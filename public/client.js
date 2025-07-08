// public/client.js - This code runs in the browser.

const socket = io();
let myPlayerId = null;
let roomCode = null;

// --- DOM Element References ---
const allScreens = document.querySelectorAll('.screen');
const homeScreen = document.getElementById('home-screen');
const createGameBtn = document.getElementById('create-game-btn');
const joinGameBtn = document.getElementById('join-game-btn');
const usernameCreateInput = document.getElementById('username-create-input');
const usernameJoinInput = document.getElementById('username-join-input');
const roomCodeInput = document.getElementById('room-code-input');
const errorMessageEl = document.getElementById('error-message');
const infoPanel = document.getElementById('info-panel');
const questionEl = document.getElementById('question');
const gameStatusEl = document.getElementById('game-status');
const leaderboardEl = document.getElementById('leaderboard');
const playerIdentityEl = document.getElementById('player-identity');
const lobbyScreen = document.getElementById('lobby-screen');
const lobbyRoomCodeEl = document.getElementById('lobby-room-code');
const lobbyMessageEl = document.getElementById('lobby-message');
const lobbyPlayerCountEl = document.getElementById('lobby-player-count');
const teamSelectionWrapper = document.getElementById('team-selection-wrapper');
const teamACountEl = document.getElementById('team-a-count');
const teamBCountEl = document.getElementById('team-b-count');
const teamAListEl = document.getElementById('team-a-list');
const teamBListEl = document.getElementById('team-b-list');
const unassignedListEl = document.getElementById('unassigned-list');
const joinTeamABtn = document.getElementById('join-team-a-btn');
const joinTeamBBtn = document.getElementById('join-team-b-btn');
const startGameBtn = document.getElementById('start-game-btn');
const mainGameScreen = document.getElementById('main-game-screen');
const answerBoardEl = document.getElementById('answer-board');
const decisionBoxEl = document.getElementById('decision-box');
const revealScreen = document.getElementById('reveal-screen');
const revealListEl = document.getElementById('reveal-list');
const bonusScreen = document.getElementById('bonus-round-screen');
const bonusInstructionsEl = document.getElementById('bonus-instructions');
const bonusWinningsEl = document.getElementById('bonus-winnings');
const strikesDisplayEl = document.getElementById('strikes-display');
const bonusBoardEl = document.getElementById('bonus-board');
const bonusRevealedBoardEl = document.getElementById('bonus-revealed-board');
const postGameScreen = document.getElementById('post-game-screen');
const postGameTeamNameEl = document.getElementById('post-game-team-name');
const postGameTitleEl = document.getElementById('post-game-title');
const postGameWinningsEl = document.getElementById('post-game-winnings');
const finalTeamMembersEl = document.querySelector('#post-game-screen .final-team-members');
const finalCorrectOrderEl = document.getElementById('final-correct-order');
const playAgainBtn = document.getElementById('play-again-btn');

// --- Utility Functions ---
function showScreen(screenToShow) {
    allScreens.forEach(s => s.classList.add('hidden'));
    if (screenToShow) {
        screenToShow.classList.remove('hidden');
    }
}

// --- Socket Listeners ---
socket.on('connect', () => { myPlayerId = socket.id; });
socket.on('gameCreated', (data) => { roomCode = data.roomCode; });
socket.on('joinSuccess', (data) => { roomCode = data.roomCode; });
socket.on('gameStateUpdate', (gameState) => { render(gameState); });
socket.on('error', (data) => {
    console.error('Server error:', data.message);
    if (!roomCode) {
        errorMessageEl.textContent = data.message;
    } else {
        alert(data.message);
        roomCode = null;
        showScreen(homeScreen);
    }
});

// --- Event Handlers ---
createGameBtn.addEventListener('click', () => {
    errorMessageEl.textContent = '';
    const username = usernameCreateInput.value.trim() || 'Anonymous';
    socket.emit('createGame', { username });
});

joinGameBtn.addEventListener('click', () => {
    errorMessageEl.textContent = '';
    const code = roomCodeInput.value.trim().toUpperCase();
    const username = usernameJoinInput.value.trim() || 'Anonymous';
    if (!code) {
        errorMessageEl.textContent = 'Please enter a room code.';
        return;
    }
    socket.emit('joinGame', { roomCode: code, username: username });
});

joinTeamABtn.addEventListener('click', () => { socket.emit('joinTeam', { roomCode, teamId: 'teamA' }); });
joinTeamBBtn.addEventListener('click', () => { socket.emit('joinTeam', { roomCode, teamId: 'teamB' }); });
startGameBtn.addEventListener('click', () => { socket.emit('startGame', { roomCode }); });
playAgainBtn.addEventListener('click', () => { socket.emit('playAgain', { roomCode }); });

// --- Main Render Function ---
function render(gs) {
    switch (gs.phase) {
        case 'LOBBY':
            showScreen(lobbyScreen);
            infoPanel.classList.add('hidden');
            renderLobby(gs);
            break;
        case 'IN_GAME':
        case 'REVEAL':
        case 'GAME_OVER':
            showScreen(mainGameScreen);
            infoPanel.classList.remove('hidden');
            questionEl.textContent = gs.turnData?.question;
            gameStatusEl.textContent = gs.turnData?.message;
            renderPlayerIdentity(gs);
            renderMainGame(gs);
            if (gs.phase === 'REVEAL' || gs.phase === 'GAME_OVER') {
                revealScreen.classList.remove('hidden');
                renderReveal(gs);
            } else {
                revealScreen.classList.add('hidden');
            }
            break;
        case 'BONUS_ROUND':
            showScreen(bonusScreen);
            infoPanel.classList.remove('hidden');
            questionEl.textContent = gs.bonusData?.question;
            bonusInstructionsEl.textContent = gs.bonusData?.instructions;
            gameStatusEl.textContent = gs.bonusData?.message;
            renderPlayerIdentity(gs);
            renderBonusRound(gs);
            break;
        case 'POST_GAME':
            showScreen(postGameScreen);
            infoPanel.classList.add('hidden');
            renderPostGame(gs);
            break;
    }
}

function renderLobby(gs) {
    lobbyRoomCodeEl.textContent = `Room Code: ${roomCode}`;
    const allPlayers = Object.values(gs.players);
    lobbyPlayerCountEl.textContent = allPlayers.length;
    const teamAPlayers = gs.teams.teamA.players;
    const teamBPlayers = gs.teams.teamB.players;
    const unassignedPlayers = allPlayers.filter(p => gs.unassignedPlayerIds.includes(p.id));
    const myPlayerIsOnTeam = teamAPlayers.some(p => p.id === myPlayerId) || teamBPlayers.some(p => p.id === myPlayerId);
    if (allPlayers.length === 4) {
        teamSelectionWrapper.classList.remove('hidden');
        lobbyMessageEl.textContent = 'Please select a team.';
    } else {
        teamSelectionWrapper.classList.add('hidden');
        lobbyMessageEl.textContent = `Waiting for players... (${allPlayers.length}/4)`;
    }
    const renderPlayerList = (listEl, players) => {
        listEl.innerHTML = players.map(p => `<div>${p.username} ${p.id === gs.hostId ? '(Host)' : ''}</div>`).join('');
    };
    renderPlayerList(unassignedListEl, unassignedPlayers);
    renderPlayerList(teamAListEl, teamAPlayers);
    renderPlayerList(teamBListEl, teamBPlayers);
    teamACountEl.textContent = teamAPlayers.length;
    teamBCountEl.textContent = teamBPlayers.length;
    joinTeamABtn.disabled = myPlayerIsOnTeam || teamAPlayers.length >= 2;
    joinTeamBBtn.disabled = myPlayerIsOnTeam || teamBPlayers.length >= 2;
    const teamsAreReady = teamAPlayers.length === 2 && teamBPlayers.length === 2;
    if (myPlayerId === gs.hostId && teamsAreReady) {
        startGameBtn.classList.remove('hidden');
    } else {
        startGameBtn.classList.add('hidden');
    }
}

function renderPlayerIdentity(gs) {
    let myTeam = null;
    let myRole = 'Observer';
    if (!gs.teams) return;
    for (const team of Object.values(gs.teams)) {
        if (team.players && team.players.find(p => p.id === myPlayerId)) {
            myTeam = team;
            break;
        }
    }
    if (!myTeam) {
        playerIdentityEl.innerHTML = 'You are observing.';
        return;
    }
    if (gs.phase === 'IN_GAME' && gs.turnData) {
        if (gs.turnData.picker?.id === myPlayerId) myRole = 'Picker';
        if (gs.turnData.decider?.id === myPlayerId) myRole = 'Decider';
    } else if (gs.phase === 'BONUS_ROUND' && gs.bonusData) {
        const bonusTeamPlayers = gs.bonusData.winningTeam.players;
        if (bonusTeamPlayers.some(p => p.id === myPlayerId)) {
            myRole = bonusTeamPlayers[gs.bonusData.currentPickerIndex]?.id === myPlayerId ? 'Picker' : 'Partner';
        }
    }
    playerIdentityEl.innerHTML = `You are on <strong>${myTeam.name}</strong>. Your role: <strong>${myRole}</strong>`;
}

function renderMainGame(gs) {
    const { turnData, teams } = gs;
    if (!turnData || !teams) return;
    leaderboardEl.innerHTML = `<span>${teams.teamA.name}: ${teams.teamA.score}</span> | <span>${teams.teamB.name}: ${teams.teamB.score}</span>`;
    const myRole = turnData.picker?.id === myPlayerId ? 'Picker' : (turnData.decider?.id === myPlayerId ? 'Decider' : null);
    const canPick = myRole === 'Picker' && (turnData.turnPhase === 'PICKING_TWO' || turnData.turnPhase === 'PICKING_ONE');
    const canDecide = myRole === 'Decider' && turnData.turnPhase === 'DECIDING';
    createCards(answerBoardEl, turnData.boardAnswers, canPick);
    createCards(decisionBoxEl, turnData.decisionBox, canDecide);
}

function renderReveal(gs) {
    if (!gs.turnData) return;
    revealListEl.innerHTML = '';
    gs.turnData.correctlyRankedAnswers.forEach((answer, index) => {
        const item = document.createElement('div');
        item.className = 'reveal-item';
        item.textContent = `${index + 1}. ${answer.text} (${answer.stat})`;
        revealListEl.appendChild(item);
    });
}

function renderBonusRound(gs) {
    const { bonusData } = gs;
    if (!bonusData) return;
    leaderboardEl.innerHTML = `<h3>Bonus Round for ${bonusData.winningTeam.name}</h3>`;
    bonusWinningsEl.textContent = `Winnings: $${bonusData.bonusWinnings}`;
    strikesDisplayEl.textContent = `Strikes: ${'X '.repeat(bonusData.strikes)}`;
    const canPick = bonusData.winningTeam.players[bonusData.currentPickerIndex]?.id === myPlayerId && !bonusData.isOver;
    createCards(bonusBoardEl, bonusData.boardAnswers, canPick);
    bonusRevealedBoardEl.innerHTML = '';
    bonusData.revealedAnswers.forEach(answer => {
        const card = createCard(`${answer.text} (${answer.stat})`, false);
        card.classList.toggle('strike', answer.isStrike);
        bonusRevealedBoardEl.appendChild(card);
    });
}

function renderPostGame(gs) {
    const { postGameData } = gs;
    if (!postGameData) return;
    const { winningTeam, wasBonusWon, bonusWinnings, correctBonusOrder } = postGameData;
    postGameTeamNameEl.textContent = winningTeam.name;
    postGameTitleEl.textContent = wasBonusWon ? "WINNERS!" : "LOSERS!";
    postGameWinningsEl.textContent = `Total Winnings: $${bonusWinnings}`;
    const finalCard = postGameScreen.querySelector('.final-card');
    finalCard.classList.toggle('winner', wasBonusWon);
    finalCard.classList.toggle('loser', !wasBonusWon);
    finalTeamMembersEl.innerHTML = winningTeam.players.map(p => `<div>${p.username}</div>`).join('');
    finalCorrectOrderEl.innerHTML = '';
    correctBonusOrder.forEach(answer => {
        const item = document.createElement('div');
        item.className = 'reveal-item';
        item.textContent = `${answer.rank}. ${answer.text} (${answer.stat})`;
        finalCorrectOrderEl.appendChild(item);
    });
}

function createCard(text, canInteract) {
    const card = document.createElement('button');
    card.className = 'card';
    card.textContent = text;
    card.disabled = !canInteract;
    if (canInteract) {
        card.onclick = () => socket.emit('playerAction', { roomCode, payload: text });
    }
    return card;
}

function createCards(container, answers, canInteract) {
    container.innerHTML = '';
    if (!answers) return;
    answers.forEach(answerText => {
        const card = createCard(answerText, canInteract);
        container.appendChild(card);
    });
}