// ── Versus Signaling & Matchmaking Server ────────────────────────────────────
// Targets Render Free-Tier.
// Features:
//   - HTTP /health endpoint for Render uptime monitoring (prevents spin-down)
//   - WebSocket endpoint for WebRTC signaling (SDP offer/answer, ICE candidates)
//   - Casual Matchmaking Queue (FIFO random matchmaking)
//   - Ranked Matchmaking Queue (Skill-bracket matching +/- 150 RP)
//   - Custom Party Code rooms (VR-XXXX for friend 1v1 invites)

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 10000;

// HTTP server for health checks & ping
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            service: 'versus-signaling',
            timestamp: Date.now(),
            activeLobbies: activeRooms.size,
            casualQueue: casualQueue.length,
            rankedQueue: rankedQueue.length
        }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocketServer({ server });

// State
const casualQueue = []; // [{ ws, playerId, playerName }]
const rankedQueue = []; // [{ ws, playerId, playerName, rating, deviation }]
const activeRooms = new Map(); // roomCode -> { host: ws, guest: ws, matchData }

function generatePartyCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = 'VR-';
    for (let i = 0; i < 4; ++i) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.roomCode = null;
    ws.playerId = null;
    ws.playerName = 'Player';

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('Invalid message format:', e);
        }
    });

    ws.on('close', () => {
        removeFromQueues(ws);
        handleDisconnect(ws);
    });
});

function handleMessage(ws, data) {
    const { type } = data;

    switch (type) {
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;

        case 'join_casual_queue': {
            removeFromQueues(ws);
            ws.playerId = data.playerId;
            ws.playerName = data.playerName || 'Player';

            // Match with someone if queue is not empty
            if (casualQueue.length > 0) {
                const opponent = casualQueue.shift();
                if (opponent.ws.readyState === WebSocket.OPEN) {
                    const matchId = `match_${Date.now()}`;
                    console.log(`Casual match found: ${opponent.playerName} vs ${ws.playerName}`);
                    
                    // Assign Host and Guest
                    opponent.ws.opponent = ws;
                    ws.opponent = opponent.ws;

                    opponent.ws.send(JSON.stringify({
                        type: 'match_found',
                        matchId,
                        role: 'host',
                        mode: 'casual',
                        opponent: { id: ws.playerId, name: ws.playerName }
                    }));

                    ws.send(JSON.stringify({
                        type: 'match_found',
                        matchId,
                        role: 'guest',
                        mode: 'casual',
                        opponent: { id: opponent.playerId, name: opponent.playerName }
                    }));
                    return;
                }
            }

            casualQueue.push({ ws, playerId: ws.playerId, playerName: ws.playerName });
            ws.send(JSON.stringify({ type: 'queue_joined', mode: 'casual' }));
            break;
        }

        case 'join_ranked_queue': {
            removeFromQueues(ws);
            ws.playerId = data.playerId;
            ws.playerName = data.playerName || 'Player';
            ws.rating = data.rating || 1500;

            // Search ranked queue for someone within +/- 150 RP
            let matchIdx = -1;
            for (let i = 0; i < rankedQueue.length; ++i) {
                const diff = Math.abs(rankedQueue[i].rating - ws.rating);
                if (diff <= 200 && rankedQueue[i].ws.readyState === WebSocket.OPEN) {
                    matchIdx = i;
                    break;
                }
            }

            if (matchIdx !== -1) {
                const opponent = rankedQueue.splice(matchIdx, 1)[0];
                const matchId = `ranked_${Date.now()}`;
                console.log(`Ranked match found: ${opponent.playerName} (${opponent.rating}) vs ${ws.playerName} (${ws.rating})`);

                opponent.ws.opponent = ws;
                ws.opponent = opponent.ws;

                opponent.ws.send(JSON.stringify({
                    type: 'match_found',
                    matchId,
                    role: 'host',
                    mode: 'ranked',
                    opponent: { id: ws.playerId, name: ws.playerName, rating: ws.rating }
                }));

                ws.send(JSON.stringify({
                    type: 'match_found',
                    matchId,
                    role: 'guest',
                    mode: 'ranked',
                    opponent: { id: opponent.playerId, name: opponent.playerName, rating: opponent.rating }
                }));
                return;
            }

            rankedQueue.push({ ws, playerId: ws.playerId, playerName: ws.playerName, rating: ws.rating });
            ws.send(JSON.stringify({ type: 'queue_joined', mode: 'ranked', rating: ws.rating }));
            break;
        }

        case 'create_party': {
            removeFromQueues(ws);
            const code = generatePartyCode();
            activeRooms.set(code, { host: ws, guest: null });
            ws.roomCode = code;
            ws.playerId = data.playerId;
            ws.playerName = data.playerName || 'Player';

            ws.send(JSON.stringify({
                type: 'party_created',
                code
            }));
            console.log(`Party created: ${code} by ${ws.playerName}`);
            break;
        }

        case 'join_party': {
            removeFromQueues(ws);
            const code = (data.code || '').toUpperCase().trim();
            const room = activeRooms.get(code);

            if (!room) {
                ws.send(JSON.stringify({ type: 'party_error', message: 'Room code not found.' }));
                return;
            }

            if (room.guest) {
                ws.send(JSON.stringify({ type: 'party_error', message: 'Room is already full.' }));
                return;
            }

            room.guest = ws;
            ws.roomCode = code;
            ws.playerId = data.playerId;
            ws.playerName = data.playerName || 'Player';

            room.host.opponent = ws;
            ws.opponent = room.host;

            const matchId = `party_${code}_${Date.now()}`;

            room.host.send(JSON.stringify({
                type: 'match_found',
                matchId,
                role: 'host',
                mode: 'casual_party',
                opponent: { id: ws.playerId, name: ws.playerName }
            }));

            ws.send(JSON.stringify({
                type: 'match_found',
                matchId,
                role: 'guest',
                mode: 'casual_party',
                opponent: { id: room.host.playerId, name: room.host.playerName }
            }));

            console.log(`Party ${code} matched: ${room.host.playerName} and ${ws.playerName}`);
            break;
        }

        // WebRTC Signaling Relay: offer, answer, ice_candidate
        case 'signal_offer':
        case 'signal_answer':
        case 'signal_candidate': {
            if (ws.opponent && ws.opponent.readyState === WebSocket.OPEN) {
                ws.opponent.send(JSON.stringify(data));
            }
            break;
        }

        case 'leave_queue': {
            removeFromQueues(ws);
            ws.send(JSON.stringify({ type: 'queue_left' }));
            break;
        }
    }
}

function removeFromQueues(ws) {
    const cIdx = casualQueue.findIndex(q => q.ws === ws);
    if (cIdx !== -1) casualQueue.splice(cIdx, 1);

    const rIdx = rankedQueue.findIndex(q => q.ws === ws);
    if (rIdx !== -1) rankedQueue.splice(rIdx, 1);
}

function handleDisconnect(ws) {
    if (ws.roomCode && activeRooms.has(ws.roomCode)) {
        const room = activeRooms.get(ws.roomCode);
        if (room.host === ws && room.guest && room.guest.readyState === WebSocket.OPEN) {
            room.guest.send(JSON.stringify({ type: 'opponent_disconnected' }));
        } else if (room.guest === ws && room.host && room.host.readyState === WebSocket.OPEN) {
            room.host.send(JSON.stringify({ type: 'opponent_disconnected' }));
        }
        activeRooms.delete(ws.roomCode);
    }

    if (ws.opponent && ws.opponent.readyState === WebSocket.OPEN) {
        ws.opponent.send(JSON.stringify({ type: 'opponent_disconnected' }));
        ws.opponent.opponent = null;
    }
}

// Keep-alive interval for WebSocket connections
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.listen(PORT, () => {
    console.log(`Versus Signaling Server running on port ${PORT}`);
});
