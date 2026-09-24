import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import { sessionManager } from './sessionManager.js';
import { battleEngine } from './battleEngine.js';
import { missingCatsManager } from './missingCatsManager.js';

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static('public'));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

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
        sessionId: session.id,
        type: session.type,
        expiresAt: session.createdAt + (5 * 60 * 1000)
    });
});

// --- STOCKAGE ET GESTION DES CHATS PARTAGÉS HD ---
const sharedCats = new Map();

// 1. Envoi du chat partagé depuis l'application
app.post('/share/cat/upload', (req, res) => {
    const { shareId, catData } = req.body;
    if (!shareId || !catData) {
        return res.status(400).json({ error: 'Données manquantes.' });
    }
    sharedCats.set(shareId, {
        catData,
        createdAt: Date.now()
    });
    console.log(`[SHARE] Chat partagé enregistré sous l'ID : ${shareId}`);
    return res.json({ success: true, shareId });
});

// 2. Récupération des données JSON du chat partagé pour l'application CatCher
app.get('/share/cat/data/:shareId', (req, res) => {
    const entry = sharedCats.get(req.params.shareId);
    if (!entry) {
        return res.status(404).json({ error: 'Chat partagé introuvable ou expiré.' });
    }
    return res.json(entry.catData);
});

// 3. Affichage Web de secours (Navigateur PC / Aperçu WhatsApp)
app.get('/share/cat', (req, res) => {
    const shareId = req.query.id || '';
    res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>CatCher - Félin Partagé 🐱</title>
            <meta property="og:title" content="Découvre ce félin HD sur CatCher !" />
            <meta property="og:description" content="Clique pour ajouter ce chat partagé directement dans ton album Cat-Log !" />
            <style>
                body { font-family: system-ui, sans-serif; background: #0F172A; color: white; text-align: center; padding: 40px; }
                .card { background: #1E293B; border-radius: 16px; padding: 24px; max-width: 400px; margin: 0 auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                .btn { display: inline-block; background: #6366F1; color: white; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold; margin-top: 20px; }
                code { background: #334155; padding: 4px 8px; border-radius: 6px; font-family: monospace; color: #38BDF8; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🐱 CatCher - Félin Partagé</h1>
                <p>Code du chat : <code>${shareId}</code></p>
                <p>Ouvre ce lien sur ton téléphone avec l'application <strong>CatCher</strong> installée pour ajouter ce chat à ton Cat-Log !</p>
                <a href="catcher://share/cat?id=${shareId}" class="btn">📱 Ouvrir dans CatCher</a>
            </div>
        </body>
        </html>
    `);
});

// 4. Redirection vers le panel des avis de recherche
app.get('/avis-recherche', (req, res) => {
    res.redirect('/admin-alerts.html');
});

// --- API AVIS DE RECHERCHE DE CHATS DISPARUS ---
// 1. Récupération des avis de recherche (filtrés par zone si lat & lon fournis)
app.get('/api/missing-cats', (req, res) => {
    const { lat, lon, all } = req.query;
    if (all === 'true') {
        return res.json(missingCatsManager.getAllAlerts());
    }
    if (lat !== undefined && lon !== undefined) {
        const inZone = missingCatsManager.getAlertsInZone(lat, lon);
        return res.json(inZone);
    }
    return res.json(missingCatsManager.getActiveAlerts());
});

// 2. Publication d'un avis de recherche félin
app.post('/api/missing-cats', (req, res) => {
    const { name, ownerName, contact, description, photo, latitude, longitude, radiusKm } = req.body;
    if (!name || !contact || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: "Champs obligatoires manquants : nom, contact, latitude, longitude." });
    }

    try {
        const alert = missingCatsManager.createAlert({
            name,
            ownerName,
            contact,
            description,
            photo,
            latitude,
            longitude,
            radiusKm
        });
        return res.status(201).json({ success: true, alert });
    } catch (err) {
        console.error("Erreur création avis de recherche:", err);
        return res.status(500).json({ error: "Erreur lors de la création de l'avis." });
    }
});

// 3. Marquer un chat comme retrouvé
app.post('/api/missing-cats/:id/found', (req, res) => {
    const { id } = req.params;
    const alert = missingCatsManager.markAsFound(id);
    if (!alert) {
        return res.status(404).json({ error: "Avis de recherche introuvable." });
    }
    return res.json({ success: true, message: `Chat ${alert.name} marqué comme retrouvé !`, alert });
});

// 4. Clôturer / Supprimer un avis
app.delete('/api/missing-cats/:id', (req, res) => {
    const { id } = req.params;
    const deleted = missingCatsManager.deleteAlert(id);
    if (!deleted) {
        return res.status(404).json({ error: "Avis de recherche introuvable." });
    }
    return res.json({ success: true, message: "Avis supprimé." });
});

// --- PASSERELLE WEBSOCKET ---
wss.on('connection', (ws) => {
    let currentRoomId = null;
    let currentPlayerId = null;

    // L'écouteur de messages est bien imbriqué à l'intérieur, là où 'ws' existe !
    ws.on('message', (message) => {
        try {
            const rawText = message.toString();
            console.log(`\n📬 [WS REÇU] Brut de ${currentPlayerId || 'Inconnu'}:`, rawText);

            const data = JSON.parse(rawText);

            switch (data.action) {
                case 'join_room': {
                    const sessionId = data.sessionId.toUpperCase().trim();
                    const playerId = data.playerId;
                    
                    const session = sessionManager.getSession(sessionId);
                    const existingRoom = rooms.get(sessionId);

                    if (!session && !existingRoom) {
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
                    
                    const existingClientIndex = room.clients.findIndex(c => c.playerId === playerId);
                    if (existingClientIndex !== -1) {
                        room.clients[existingClientIndex].ws = ws;
                        console.log(`[WS] Joueur ${playerId} s'est reconnecté au salon [${currentRoomId}]`);
                    } else if (room.clients.length >= 2) {
                        ws.send(JSON.stringify({ event: 'error', message: 'Ce salon est déjà complet.' }));
                        return ws.close();
                    } else {
                        room.clients.push({ ws, playerId });
                        console.log(`[WS] Joueur ${playerId} a rejoint le salon [${currentRoomId}]`);
                    }

                    if (room.clients.length === 2) {
                        if (session) session.status = "connected";
                        const sessionType = session ? session.type : "duel";
                        room.clients.forEach(client => {
                            const opponent = room.clients.find(c => c.ws !== client.ws);
                            client.ws.send(JSON.stringify({ 
                                event: 'room_ready', 
                                type: sessionType,
                                opponentId: opponent ? opponent.playerId : 'opponent'
                            }));
                        });
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
                            totalFighters: data.totalFighters || 1,
                            koCount: isNewPlayer ? 0 : (room.gameState.cats[currentPlayerId]?.koCount || 0)
                        };

                        console.log(`[BATTLE] Données validées pour ${currentPlayerId}`);

                        const playerIds = room.clients.map(c => c.playerId);
                        const allReady = playerIds.length === 2 && playerIds.every(id => room.gameState.cats[id]);

                        if (allReady && !room.gameState.turn) {
                            room.gameState.turn = room.clients[0].playerId; 
                            console.log(`[BATTLE] Prêts ! Premier tour attribué à : ${room.gameState.turn}`);

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

                        const isGameOver = targetCat.koCount >= targetCat.totalFighters;

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
                        let payload = data.payload;

                        if (!room.gameState) room.gameState = {};
                        if (!room.gameState.cats) room.gameState.cats = {};
                        if (!room.gameState.activeIndices) room.gameState.activeIndices = {};

                        if (payload && payload.type === 'opponent_team_sync' && payload.cat) {
                            const c = payload.cat;
                            room.gameState.cats[currentPlayerId] = [{
                                name: c.name,
                                type: c.type,
                                hp: c.hp,
                                maxHp: c.maxHp || c.hp,
                                moves: c.moves || []
                            }];
                            room.gameState.activeIndices[currentPlayerId] = 0;
                            console.log(`[BATTLE SERVER] Équipe enregistrée via opponent_team_sync pour ${currentPlayerId}`);
                        }

                        if (payload && payload.type === 'duel_line' && payload.line) {
                            const line = payload.line;

                            if (line.startsWith('catcher_duel_team:')) {
                                try {
                                    const base64 = line.split('catcher_duel_team:')[1];
                                    const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
                                    const team = JSON.parse(jsonStr);
                                    room.gameState.cats[currentPlayerId] = team;
                                    room.gameState.activeIndices[currentPlayerId] = 0;
                                    console.log(`[BATTLE SERVER] Équipe enregistrée pour ${currentPlayerId} (${team.length} chats)`);
                                } catch (e) {
                                    console.error("[BATTLE SERVER] Erreur parsing équipe:", e);
                                }
                            }

                            if (line.startsWith('catcher_duel_action:')) {
                                try {
                                    const base64 = line.split('catcher_duel_action:')[1];
                                    const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
                                    const actionInfo = JSON.parse(jsonStr);
                                    if (!actionInfo.senderId) {
                                        actionInfo.senderId = currentPlayerId;
                                    }

                                    if (actionInfo.actionType === 'ATTACK' && room.gameState) {
                                        const opponentClient = room.clients.find(c => c.ws !== ws);
                                        const opponentId = opponentClient ? opponentClient.playerId : null;
                                        
                                        const attackerCats = room.gameState.cats[currentPlayerId];
                                        const targetCats = opponentId ? room.gameState.cats[opponentId] : null;
                                        const targetIndex = opponentId ? (room.gameState.activeIndices[opponentId] || 0) : 0;

                                        if (attackerCats && targetCats && targetCats[targetIndex]) {
                                            const targetCat = targetCats[targetIndex];
                                            const rawDamage = actionInfo.rawDamage || actionInfo.damage || 20;
                                            const attackerType = actionInfo.attackerType || attackerCats[0]?.type || 'URBAIN';
                                            const qteMult = actionInfo.qteMultiplier || 1.0;

                                            const finalDamage = battleEngine.calculateFinalDamage(
                                                { name: actionInfo.moveName || "Attaque", damage: rawDamage },
                                                attackerType,
                                                targetCat.type,
                                                qteMult
                                            );

                                            targetCat.hp = Math.max(0, targetCat.hp - finalDamage);
                                            actionInfo.damage = finalDamage;
                                            actionInfo.targetNewHp = targetCat.hp;

                                            console.log(`[BATTLE SERVER] Attaque autoritaire: ${actionInfo.moveName} -> ${finalDamage} dégâts subis par ${targetCat.name} (PV restants: ${targetCat.hp})`);
                                        }
                                    } else if (actionInfo.actionType === 'SWITCH' && room.gameState) {
                                        if (!room.gameState.activeIndices) room.gameState.activeIndices = {};
                                        room.gameState.activeIndices[currentPlayerId] = actionInfo.switchIndex || 0;
                                        console.log(`[BATTLE SERVER] Changement de chat pour ${currentPlayerId} -> index ${actionInfo.switchIndex}`);
                                    }

                                    const updatedJson = JSON.stringify(actionInfo);
                                    const updatedBase64 = Buffer.from(updatedJson, 'utf8').toString('base64');
                                    payload = {
                                        type: 'duel_line',
                                        line: `catcher_duel_action:${updatedBase64}`
                                    };
                                } catch (e) {
                                    console.error("[BATTLE SERVER] Erreur calcul autoritaire action:", e);
                                }
                            }
                        }

                        // Relayer l'action à l'adversaire
                        room.clients.forEach(client => {
                            if (client.ws !== ws) {
                                client.ws.send(JSON.stringify({
                                    event: 'opponent_action',
                                    payload: payload 
                                }));
                            }
                        });

                        // Renvoyer la réponse autoritaire également à l'attaquant pour synchro immédiate
                        if (payload && payload.line && payload.line.startsWith('catcher_duel_action:')) {
                            ws.send(JSON.stringify({
                                event: 'opponent_action',
                                payload: payload
                            }));
                        }
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
