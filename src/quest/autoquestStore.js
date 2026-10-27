/**
 * autoquestStore.js - JSON Based + Booster Lock 15 Invite OR 1 Boost
 * Location: src/quest/autoquestStore.js
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRoles } from './roleStore.js';

const AUTOQUEST_FILE = path.join(process.cwd(), 'data', 'autoquest.json');

function ensureDirectory() {
    try {
        const dir = path.dirname(AUTOQUEST_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(AUTOQUEST_FILE)) fs.writeFileSync(AUTOQUEST_FILE, JSON.stringify([], null, 2));
    } catch {}
}

function load() {
    try {
        ensureDirectory();
        if (!fs.existsSync(AUTOQUEST_FILE)) return [];
        const raw = JSON.parse(fs.readFileSync(AUTOQUEST_FILE, 'utf-8'));
        return Array.isArray(raw) ? raw : [];
    } catch { return []; }
}

function save(data) {
    try { ensureDirectory(); fs.writeFileSync(AUTOQUEST_FILE, JSON.stringify(data, null, 2)); } catch {}
}

// ── Booster Check - 15 Invite OR 1 Boost = Bypass ──────────────────────────
export async function isBooster(member) {
    try {
        if (!member) return false;
        if (member.premiumSince) return true; // Boosting
        const roles = getRoles(member.guild.id);
        if (roles.ROLE_1_BOOST && member.roles.cache.has(roles.ROLE_1_BOOST)) return true;
        if (roles.ROLE_2_BOOST && member.roles.cache.has(roles.ROLE_2_BOOST)) return true;
        
        // 15 Invite check
        try {
            const InviteTracker = (await import('../handlers/inviteTracker.js')).default;
            const tracker = await InviteTracker.findOne({ guildId: member.guild.id, userId: member.id }).catch(()=>null);
            if (tracker && tracker.invites >= 15) return true;
        } catch {}
        
        return false;
    } catch { return false; }
}

export async function getLockMessageForAutoquest(member) {
    let invites = 0;
    try {
        const InviteTracker = (await import('../handlers/inviteTracker.js')).default;
        const tracker = await InviteTracker.findOne({ guildId: member.guild.id, userId: member.id }).catch(()=>null);
        invites = tracker?.invites || 0;
    } catch {}
    
    const needMore = Math.max(0, 15 - invites);
    return {
        title: '🔒 Autoquest Locked — Server Booster Only',
        desc: `**Requirement:** Boost OR 15 Invites\n**Your Progress:** ${invites}/15 invites\n**How:** Invite ${needMore} more OR Boost server - 1 Boost = All slots unlock!`
    };
}

export async function canUseAutoquest(member) {
    const booster = await isBooster(member);
    if (!booster) {
        const lock = await getLockMessageForAutoquest(member);
        return { allowed: false, lock };
    }
    return { allowed: true };
}

// ── JSON Storage System ────────────────────────────────────────────────────
export function enableAutoquest(userId) {
    const data = load();
    if (data.includes(userId)) return false;
    data.push(userId);
    save(data);
    return true;
}

export function disableAutoquest(userId) {
    const data = load();
    const idx = data.indexOf(userId);
    if (idx === -1) return false;
    data.splice(idx, 1);
    save(data);
    return true;
}

export function isAutoquestEnabled(userId) { return load().includes(userId); }
export function getAutoquestUsers() { return load(); }
export function getAutoquestUserCount() { return load().length; }
