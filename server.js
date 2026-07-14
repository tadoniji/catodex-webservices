import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import { sessionManager } from './sessionManager.js';

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map(); 

// --- ROUTE HTTP : Création de la session ---
app.post('/api/session/create', (req, res) => {
    const { type, playerId } = req.body;
    
    if (!type || !playerId) {
        return res.status(400).json({ error: "Paramètres manquants." });
    }

    const session = sessionManager.createSession(type, playerId);
    
    res.status(201).json({
        sessionId: session.id, // Renvoie le code à 6 lettres (ex: "XQZFTW")
        type: session.type,
        expiresAt: session.createdAt + (5 * 60 * 1000)
    });
});

// --- PASSERELLE WEBSOCKET ---
wss.on('connection', (ws) => {
    let currentRoomId = null;
    let currentPlayerId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.action) {
                case 'join_room':
                    // On force la mise en majuscule du code reçu
                    const sessionId = data.sessionId.toUpperCase().trim();
                    const playerId = data.playerId;
                    
                    const session = sessionManager.getSession(sessionId);

                    if (!session) {
                        ws.send(JSON.stringify({ event: 'error', message: 'Code invalide ou session expirée.' }));
                        return ws.close();
                    }

                    currentRoomId = sessionId;
                    currentPlayerId = playerId;

                    if (!rooms.has(currentRoomId)) {
                        rooms.set(currentRoomId, []);
                    }

                    const roomClients = rooms.get(currentRoomId);
                    
                    if (roomClients.length >= 2) {
                        ws.send(JSON.stringify({ event: 'error', message: 'Ce salon est déjà complet.' }));
                        return ws.close();
                    }

                    roomClients.push({ ws, playerId });
                    console.log(`[WS] Joueur ${playerId} a rejoint le salon AmongUs [${currentRoomId}]`);

                    if (roomClients.length === 2) {
                        session.status = "connected";
                        roomClients.forEach(client => {
                            client.ws.send(JSON.stringify({ 
                                event: 'room_ready', 
                                type: session.type,
                                opponentId: roomClients.find(c => c.playerId !== client.playerId).playerId
                            }));
                        });
                        sessionManager.deleteSession(currentRoomId);
                    }
                    break;

                case 'game_action':
                    if (currentRoomId && rooms.has(currentRoomId)) {
                        const targets = rooms.get(currentRoomId);
                        targets.forEach(client => {
                            if (client.playerId !== currentPlayerId) {
                                client.ws.send(JSON.stringify({
                                    event: 'opponent_action',
                                    payload: data.payload 
                                }));
                            }
                        });
                    }
                    break;
            }
        } catch (err) {
            console.error("Erreur JSON:", err);
        }
    });

    ws.on('close', () => {
        if (currentRoomId && rooms.has(currentRoomId)) {
            const remainingClients = rooms.get(currentRoomId).filter(client => client.ws !== ws);
            if (remainingClients.length === 0) {
                rooms.delete(currentRoomId);
            } else {
                rooms.set(currentRoomId, remainingClients);
                remainingClients.forEach(client => {
                    client.ws.send(JSON.stringify({ event: 'opponent_disconnected' }));
                });
            }
            console.log(`[WS] Déconnexion du salon [${currentRoomId}]`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Serveur en ligne. Prêt pour les codes à 6 lettres sur le port ${PORT}`);
});
