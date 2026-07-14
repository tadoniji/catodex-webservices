import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import { sessionManager } from './sessionManager.js';
import { battleEngine } from './battleEngine.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Éviter les blocages CORS simples
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// Route de diagnostic "Ping" pour réveiller le serveur Render en tâche de fond
app.get('/', (req, res) => {
    res.send("🚀 Cat O'Dex WebServices est en ligne et réveillé !");
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
                case 'join_room': {
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
                        rooms.set(currentRoomId, {
                            clients: [],
                            gameState: null
                        });
                    }

                    const room = rooms.get(currentRoomId);
                    
                    if (room.clients.length >= 2) {
                        ws.send(JSON.stringify({ event: 'error', message: 'Ce salon est déjà complet.' }));
                        return ws.close();
                    }

                    room.clients.push({ ws, playerId });
                    console.log(`[WS] Joueur ${playerId} a rejoint le salon [${currentRoomId}]`);

                    if (room.clients.length === 2) {
                        session.status = "connected";
                        room.clients.forEach(client => {
                            client.ws.send(JSON.stringify({ 
                                event: 'room_ready', 
                                type: session.type,
                                opponentId: room.clients.find(c => c.playerId !== client.playerId).playerId
                            }));
                        });
                        sessionManager.deleteSession(currentRoomId);
                    }
                    break;
                }

                case 'start_battle_state': {
    if (rooms.has(currentRoomId)) {
        const room = rooms.get(currentRoomId);
        if (!room.gameState) {
            room.gameState = { 
                cats: {},
                turn: null
            };
        }
        
        const isNewPlayer = !room.gameState.cats[currentPlayerId];
        
        room.gameState.cats[currentPlayerId] = {
            type: data.cat.type,
            currentHp: data.cat.hp,
            maxHp: data.cat.hp,
            totalFighters: data.totalFighters || (room.gameState.cats[currentPlayerId]?.totalFighters || 1),
            koCount: isNewPlayer ? 0 : (room.gameState.cats[currentPlayerId]?.koCount || 0)
        };

        console.log(`[BATTLE] Données reçues pour ${currentPlayerId}`);

        // Débloquer le combat si les deux joueurs ont envoyé leurs données
        const playerIds = room.clients.map(c => c.playerId);
        const allReady = playerIds.length === 2 && playerIds.every(id => room.gameState.cats[id]);

        if (allReady && !room.gameState.turn) {
            // Par défaut, l'hôte (le premier inscrit ou le premier client de la liste) commence
            room.gameState.turn = room.clients[0].playerId; 
            console.log(`[BATTLE] Les deux joueurs sont prêts. Premier tour attribué à : ${room.gameState.turn}`);

            // On envoie un faux "battle_turn_result" initial pour réveiller les interfaces
            room.clients.forEach(client => {
                client.ws.send(JSON.stringify({
                    event: 'battle_turn_result',
                    attackerId: null,
                    targetId: null,
                    attackName: "Initialisation",
                    damageDealt: 0,
                    targetNewHp: room.gameState.cats[client.playerId].currentHp,
                    nextTurnPlayerId: room.gameState.turn,
                    isKo: false,
                    isGameOver: false
                }));
            });
        }
    }
    break;
}
                }

                case 'execute_attack': {
                    if (currentRoomId && rooms.has(currentRoomId)) {
                        const room = rooms.get(currentRoomId);
                        const gameState = room.gameState;

                        if (!gameState) {
                            ws.send(JSON.stringify({ event: 'error', message: "Le combat n'est pas encore initialisé." }));
                            return;
                        }

                        if (gameState.turn !== currentPlayerId) {
                            ws.send(JSON.stringify({ event: 'error', message: "Ce n'est pas ton tour !" }));
                            return;
                        }

                        const opponentClient = room.clients.find(c => c.playerId !== currentPlayerId);
                        if (!opponentClient) {
                            ws.send(JSON.stringify({ event: 'error', message: "Adversaire introuvable." }));
                            return;
                        }

                        const opponentId = opponentClient.playerId;
                        const attackerCat = gameState.cats[currentPlayerId];
                        const targetCat = gameState.cats[opponentId];

                        if (!attackerCat || !targetCat) {
                            ws.send(JSON.stringify({ event: 'error', message: "Données des combattants incomplètes." }));
                            return;
                        }

                        const attack = data.attack;
                        const qteMultiplier = data.qteMultiplier || 1.0; 

                        const finalDamage = battleEngine.calculateFinalDamage(
                            attack, 
                            attackerCat.type, 
                            targetCat.type, 
                            qteMultiplier
                        );

                        targetCat.currentHp = Math.max(0, targetCat.currentHp - finalDamage);

                        const isKo = targetCat.currentHp === 0;
                        if (isKo) {
                            targetCat.koCount += 1;
                        }

                        // Détermination de la fin de partie (si le nombre de K.O. atteint la taille de l'équipe adverse)
                        const isGameOver = targetCat.koCount >= targetCat.totalFighters;

                        // Changement de tour (uniquement s'il n'y a pas K.O., pour laisser l'autre choisir son prochain chat)
                        if (!isKo && !isGameOver) {
                            gameState.turn = opponentId;
                        }

                        room.clients.forEach(client => {
                            client.ws.send(JSON.stringify({
                                event: 'battle_turn_result',
                                attackerId: currentPlayerId,
                                targetId: opponentId,
                                attackName: attack.name,
                                damageDealt: finalDamage,
                                targetNewHp: targetCat.currentHp,
                                nextTurnPlayerId: gameState.turn,
                                isKo: isKo,
                                isGameOver: isGameOver
                            }));
                        });
                    }
                    break;
                }

                case 'game_action': {
                    if (currentRoomId && rooms.has(currentRoomId)) {
                        const room = rooms.get(currentRoomId);
                        room.clients.forEach(client => {
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
            }
        } catch (err) {
            console.error("Erreur JSON:", err);
        }
    });

    ws.on('close', () => {
        if (currentRoomId && rooms.has(currentRoomId)) {
            const room = rooms.get(currentRoomId);
            const remainingClients = room.clients.filter(client => client.ws !== ws);
            
            if (remainingClients.length === 0) {
                rooms.delete(currentRoomId);
            } else {
                room.clients = remainingClients;
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
    console.log(`🚀 Serveur en ligne sur le port ${PORT}`);
});
