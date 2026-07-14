// Liste des affinités simples (x1.5)
const SPECIAL_AFFINITIES = {
    'GRIMPEUR': 'BOXEUR',
    'DORMEUR': 'CAMÉ',
    'GOURMAND': 'JOUEUR'
};

export const battleEngine = {
    // 1. Déterminer l'élément de l'attaque
    getAttackElement(attack, catType) {
        if (attack.damage > 25) {
            return catType.toUpperCase();
        }
        return "URBAIN";
    },

    // 2. Calculer le multiplicateur de type
    getTypeMultiplier(attackElement, targetType) {
        const atk = attackElement.toUpperCase();
        const tgt = targetType.toUpperCase();

        if (atk === 'URBAIN') return 1.0;

        // Règles principales
        if (atk === 'VOLCANIQUE') {
            if (tgt === 'SYLVESTRE') return 1.5;
            if (tgt === 'CÉLESTE') return 0.5;
        }
        if (atk === 'SYLVESTRE') {
            if (tgt === 'ÉLECTRIQUE') return 1.5;
            if (tgt === 'VOLCANIQUE') return 0.5;
        }
        if (atk === 'ÉLECTRIQUE') {
            if (tgt === 'CÉLESTE') return 1.5;
            if (tgt === 'SYLVESTRE') return 0.5;
        }
        if (atk === 'CÉLESTE') {
            if (tgt === 'VOLCANIQUE') return 1.5;
            if (tgt === 'ÉLECTRIQUE') return 0.5;
        }
        if (atk === 'OMBRAL') {
            if (tgt === 'CÉLESTE') return 1.5;
            if (tgt === 'URBAIN') return 0.5;
        }

        // Autres affinités spécifiques (x1.5)
        if (SPECIAL_AFFINITIES[atk] === tgt) {
            return 1.5;
        }

        return 1.0; // Par défaut
    },

    // 3. Vérifier si un QTE doit être déclenché (Dégâts > 33.3% des PV max de la cible)
    shouldTriggerQTE(attackDamage, targetMaxHp) {
        return attackDamage > (targetMaxHp * 0.333);
    },

    // 4. Calcul final des dégâts
    calculateFinalDamage(attack, attackerType, targetType, qteMultiplier = 1.0) {
        const baseDamage = attack.damage * qteMultiplier;
        const attackElement = this.getAttackElement(attack, attackerType);
        const multiplier = this.getTypeMultiplier(attackElement, targetType);

        return Math.round(baseDamage * multiplier);
    }
};
