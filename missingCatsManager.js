import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'missing_cats.json');

// Assurer l'existence du dossier data
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Calcul de distance géodésique Haversine (en km)
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon moyen de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

class MissingCatsManager {
    constructor() {
        this.alerts = new Map();
        this.loadFromFile();
    }

    loadFromFile() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const raw = fs.readFileSync(DATA_FILE, 'utf-8');
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                    list.forEach(item => this.alerts.set(item.id, item));
                }
            }
        } catch (err) {
            console.error('[MISSING_CATS] Erreur lors du chargement des avis:', err);
        }
    }

    saveToFile() {
        try {
            const list = Array.from(this.alerts.values());
            fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
        } catch (err) {
            console.error('[MISSING_CATS] Erreur lors de la sauvegarde des avis:', err);
        }
    }

    createAlert({ name, ownerName, contact, description, photo, latitude, longitude, radiusKm }) {
        const now = Date.now();
        const maxDurationMs = 7 * 24 * 60 * 60 * 1000; // 7 jours max
        const id = 'alert_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

        const alert = {
            id,
            name: (name || 'Chat sans nom').trim(),
            ownerName: (ownerName || '').trim(),
            contact: (contact || '').trim(),
            description: (description || '').trim(),
            photo: photo || null,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            radiusKm: Math.max(0.5, parseFloat(radiusKm) || 5.0),
            createdAt: now,
            expiresAt: now + maxDurationMs,
            isFound: false,
            foundAt: null
        };

        this.alerts.set(id, alert);
        this.saveToFile();
        console.log(`[MISSING_CATS] Nouvel avis créé : ${alert.name} (Rayon: ${alert.radiusKm} km)`);
        return alert;
    }

    getAllAlerts() {
        // Renvoie tous les avis avec statut à jour
        const now = Date.now();
        return Array.from(this.alerts.values()).map(alert => ({
            ...alert,
            isExpired: now > alert.expiresAt
        })).sort((a, b) => b.createdAt - a.createdAt);
    }

    getActiveAlerts() {
        const now = Date.now();
        return Array.from(this.alerts.values()).filter(alert => {
            return !alert.isFound && now <= alert.expiresAt;
        });
    }

    getAlertsInZone(userLat, userLon) {
        const uLat = parseFloat(userLat);
        const uLon = parseFloat(userLon);
        if (isNaN(uLat) || isNaN(uLon)) return [];

        const activeAlerts = this.getActiveAlerts();
        return activeAlerts.filter(alert => {
            const dist = calculateDistanceKm(uLat, uLon, alert.latitude, alert.longitude);
            return dist <= alert.radiusKm;
        }).map(alert => {
            const dist = calculateDistanceKm(uLat, uLon, alert.latitude, alert.longitude);
            return {
                ...alert,
                distanceKm: Math.round(dist * 10) / 10
            };
        });
    }

    markAsFound(id) {
        const alert = this.alerts.get(id);
        if (!alert) return null;

        alert.isFound = true;
        alert.foundAt = Date.now();
        this.saveToFile();
        console.log(`[MISSING_CATS] Chat marqué retrouvé : ${alert.name} (ID: ${id})`);
        return alert;
    }

    deleteAlert(id) {
        const existed = this.alerts.delete(id);
        if (existed) {
            this.saveToFile();
        }
        return existed;
    }
}

export const missingCatsManager = new MissingCatsManager();
