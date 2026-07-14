import crypto from 'crypto';

const sessions = new Map();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Lettres autorisées (on vire le O, le 0, le I, le 1 pour éviter les erreurs de frappe)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateAmongUsCode() {
    let code = '';
    while (code.length < 6) {
        // Génère un octet aléatoire
        const byte = crypto.randomBytes(1)[0];
        // On s'assure de rester dans les limites de notre alphabet
        if (byte < ALPHABET.length) {
            code += ALPHABET[byte];
        }
    }
    return code;
}

export const sessionManager = {
    createSession(type, hostPlayerId) {
        // Génération du code à 6 caractères (ex: "KFDZ7X")
        let sessionId = generateAmongUsCode();
        
        // Sécurité au cas rare où le code est déjà utilisé en mémoire
        while (sessions.has(sessionId)) {
            sessionId = generateAmongUsCode();
        }
        
        const sessionData = {
            id: sessionId,
            type, // "trade" ou "battle"
            hostId: hostPlayerId,
            guestId: null,
            createdAt: Date.now(),
            status: "waiting"
        };

        sessions.set(sessionId, sessionData);

        // Auto-destruction après 5 minutes
        setTimeout(() => {
            if (sessions.has(sessionId) && sessions.get(sessionId).status === "waiting") {
                sessions.delete(sessionId);
                console.log(`[Session] Expired code: ${sessionId}`);
            }
        }, SESSION_TIMEOUT);

        return sessionData;
    },

    getSession(sessionId) {
        // On passe en majuscules au cas où le joueur l'a tapé en minuscules
        const cleanId = sessionId.toUpperCase().trim();
        const session = sessions.get(cleanId);
        
        if (!session) return null;
        
        if (Date.now() - session.createdAt > SESSION_TIMEOUT) {
            sessions.delete(cleanId);
            return null;
        }
        return session;
    },

    deleteSession(sessionId) {
        sessions.delete(sessionId.toUpperCase().trim());
    }
};
