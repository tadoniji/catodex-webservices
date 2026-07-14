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

                case 'start_battle_state':
    // Initialise les PV des chats au début du combat sur le serveur
    if (rooms.has(currentRoomId)) {
        const room = rooms.get(currentRoomId);
        if (!room.gameState) room.gameState = { cats: {} };
        
        // On enregistre le chat actif du joueur
        room.gameState.cats[currentPlayerId] = {
            type: data.cat.type,
            currentHp: data.cat.hp,
            maxHp: data.cat.hp
        };
        // Le premier joueur à envoyer ses datas ou l'hôte commence
        if (!room.gameState.turn) room.gameState.turn = currentPlayerId; 
    }
    break;

case 'execute_attack':
    if (currentRoomId && rooms.has(currentRoomId)) {
        const room = rooms.get(currentRoomId);
        const gameState = room.gameState;

        // Sécurité : Est-ce bien le tour de ce joueur ?
        if (gameState.turn !== currentPlayerId) {
            ws.send(JSON.stringify({ event: 'error', message: "Ce n'est pas ton tour !" }));
            return;
        }

        const opponentId = room.clients.find(c => c.playerId !== currentPlayerId).playerId;
        const attackerCat = gameState.cats[currentPlayerId];
        const targetCat = gameState.cats[opponentId];

        // 1. Récupération des données de l'attaque envoyée par le client
        const attack = data.attack; // ex: { name: "Griffure", damage: 15 }
        const qteMultiplier = data.qteMultiplier || 1.0; // Fourni par le client si QTE réussi

        // 2. Calcul via le moteur de combat
        const finalDamage = battleEngine.calculateFinalDamage(
            attack, 
            attackerCat.type, 
            targetCat.type, 
            qteMultiplier
        );

        // 3. Application des dégâts
        targetCat.currentHp = Math.max(0, targetCat.currentHp - finalDamage);

        // 4. Changement de tour
        gameState.turn = opponentId;

        // 5. Envoi du résultat du tour aux DEUX joueurs
        room.clients.forEach(client => {
            client.ws.send(JSON.stringify({
                event: 'battle_turn_result',
                attackerId: currentPlayerId,
                targetId: opponentId,
                attackName: attack.name,
                damageDealt: finalDamage,
                targetNewHp: targetCat.currentHp,
                nextTurnPlayerId: gameState.turn,
                isKo: targetCat.currentHp === 0
            }));
        });
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
