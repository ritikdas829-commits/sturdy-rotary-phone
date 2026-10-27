/**
 * tokenStore.js - 5-Slot MongoDB Persistent Token Store with AES-256-GCM Encryption
 * Location: src/quest/tokenStore.js
 */

import * as crypto from 'node:crypto';
import mongoose from 'mongoose';

const ALGORITHM = 'aes-256-gcm';

// UPGRADED SCHEMA — Per guild + per user + per slot (1-5) — Multi server + multi user
const userTokenSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    slot: { type: Number, required: true, min: 1, max: 5, index: true },
    encryptedData: { type: String, required: true },
    username: { type: String, default: '' },
    linkedUserId: { type: String, default: '' },
    avatar: { type: String, default: '' },
    isActive: { type: Boolean, default: false },
    linkedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

userTokenSchema.index({ guildId: 1, userId: 1, slot: 1 }, { unique: true });

const TokenModel = mongoose.models.UserToken || mongoose.model('UserToken', userTokenSchema);

function deriveKey(secret) {
    return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted.toString('hex'),
    });
}

function decrypt(stored, key) {
    try {
        const { iv, tag, data } = JSON.parse(stored);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        return decipher.update(Buffer.from(data, 'hex')) + decipher.final('utf8');
    } catch {
        return null;
    }
}

export class TokenStore {
    constructor(secret) {
        if (!secret) {
            console.warn("⚠️ TokenStore secret not set - Use TOKEN_ENCRYPTION_SECRET env");
            secret = process.env.TOKEN_ENCRYPTION_SECRET || process.env.DISCORD_TOKEN || 'default-secret-change-me';
        }
        this.key = deriveKey(secret);
        this.cache = new Map();
        this.loadIntoCache();
    }

    makeCacheKey(guildId, userId, slot) {
        return `${guildId}_${userId}_slot_${slot}`;
    }

    async loadIntoCache() {
        try {
            const docs = await TokenModel.find({});
            for (const doc of docs) {
                const cacheKey = this.makeCacheKey(doc.guildId, doc.userId, doc.slot);
                this.cache.set(cacheKey, {
                    encryptedData: doc.encryptedData,
                    username: doc.username || '',
                    linkedUserId: doc.linkedUserId || doc.userId,
                    avatar: doc.avatar || '',
                    isActive: doc.isActive || false
                });
            }
            console.log(`🔑 Loaded ${docs.length} encrypted token(s) — ${new Set(docs.map(d=>d.guildId)).size} guilds — Multi server`);
        } catch (err) {
            console.error('❌ Error loading tokens from MongoDB:', err.message);
        }
    }

    // ── CRITICAL METHODS REQUIRED BY questCommands.js ──

    async getActiveSlot(guildId, userId) {
        try {
            // Find explicitly marked active slot
            let activeDoc = await TokenModel.findOne({ guildId, userId, isActive: true });
            
            // Fallback: If no slot is marked active, get the first available slot
            if (!activeDoc) {
                activeDoc = await TokenModel.findOne({ guildId, userId }).sort({ slot: 1 });
            }

            if (!activeDoc) return null;

            const token = decrypt(activeDoc.encryptedData, this.key);
            return {
                slot: activeDoc.slot,
                token: token,
                username: activeDoc.username,
                linkedUserId: activeDoc.linkedUserId || userId,
                isActive: activeDoc.isActive
            };
        } catch (err) {
            console.error(`❌ Error fetching active slot for [${guildId}] ${userId}:`, err.message);
            return null;
        }
    }

    async getActiveToken(guildId, userId) {
        const active = await this.getActiveSlot(guildId, userId);
        return active ? active.token : null;
    }

    // ── Methods required by premiumLink.js & linkGuard.js ──

    async getAllSlots(guildId, userId) {
        try {
            const docs = await TokenModel.find({ guildId, userId }).sort({ slot: 1 });
            return docs.map(doc => ({
                slot: doc.slot,
                username: doc.username || 'Unknown',
                linkedUserId: doc.linkedUserId || userId,
                avatar: doc.avatar || null,
                isActive: doc.isActive || false,
                linkedAt: doc.linkedAt || new Date()
            }));
        } catch (err) {
            console.error(`❌ Error getting all slots for [${guildId}] ${userId}:`, err.message);
            return [];
        }
    }

    async saveSlot({ guildId, ownerId, slot, token, linkedUserId = '', username = '', avatar = '', isActive = false }) {
        try {
            if (!guildId || !ownerId || !slot) return false;
            if (slot < 1 || slot > 5) return false;

            const userId = ownerId;
            
            if (isActive) {
                await TokenModel.updateMany({ guildId, userId }, { isActive: false });
            }

            const existingCount = await TokenModel.countDocuments({ guildId, userId });
            if (existingCount === 0) {
                isActive = true;
            }

            const encrypted = encrypt(token, this.key);
            const cacheKey = this.makeCacheKey(guildId, userId, slot);
            this.cache.set(cacheKey, { encryptedData: encrypted, username, linkedUserId, avatar, isActive });

            await TokenModel.findOneAndUpdate(
                { guildId, userId, slot },
                { encryptedData: encrypted, username, linkedUserId, avatar, isActive, linkedAt: new Date(), updatedAt: new Date() },
                { upsert: true, new: true }
            );

            console.log(`✅ Token saved [${guildId}] ${userId} slot ${slot} — Encrypted — Persistent`);
            return true;
        } catch (err) {
            console.error(`❌ Error saving slot [${guildId}] ${userId} slot ${slot}:`, err.message);
            return false;
        }
    }

    async removeSlot(guildId, userId, slot) {
        try {
            const cacheKey = this.makeCacheKey(guildId, userId, slot);
            const existed = this.cache.has(cacheKey);
            this.cache.delete(cacheKey);
            await TokenModel.findOneAndDelete({ guildId, userId, slot });
            
            // If removed slot was active, fallback to next available slot
            const remaining = await TokenModel.findOne({ guildId, userId }).sort({ slot: 1 });
            if (remaining) {
                await TokenModel.findOneAndUpdate({ guildId, userId, slot: remaining.slot }, { isActive: true });
            }

            console.log(`🗑️ Token removed [${guildId}] ${userId} slot ${slot}`);
            return existed;
        } catch (err) {
            console.error(`❌ Error removing slot [${guildId}] ${userId} slot ${slot}:`, err.message);
            return false;
        }
    }

    async setActiveSlot(guildId, userId, slot) {
        try {
            await TokenModel.updateMany({ guildId, userId }, { isActive: false });
            await TokenModel.findOneAndUpdate({ guildId, userId, slot }, { isActive: true });
            
            for (const [key, val] of this.cache.entries()) {
                if (key.startsWith(`${guildId}_${userId}_slot_`)) {
                    val.isActive = key === this.makeCacheKey(guildId, userId, slot);
                }
            }
            console.log(`⭐ Active slot set to #${slot} for [${guildId}] ${userId}`);
            return true;
        } catch (err) {
            console.error(`❌ Error setting active slot:`, err.message);
            return false;
        }
    }

    // ── Original Core Methods ──

    async save(guildId, userId, slot, token, username = '') {
        return await this.saveSlot({ guildId, ownerId: userId, slot, token, username });
    }

    async saveOld(userId, token) {
        return this.save('global', userId, 1, token);
    }

    get(guildId, userId, slot) {
        try {
            const cacheKey = this.makeCacheKey(guildId, userId, slot);
            const cached = this.cache.get(cacheKey);
            if (!cached) return null;
            const raw = typeof cached === 'string' ? cached : cached.encryptedData;
            return decrypt(raw, this.key);
        } catch {
            return null;
        }
    }

    getOld(userId) {
        return this.get('global', userId, 1);
    }

    getUsername(guildId, userId, slot) {
        const cacheKey = this.makeCacheKey(guildId, userId, slot);
        const cached = this.cache.get(cacheKey);
        if (!cached) return '';
        return cached.username || '';
    }

    async remove(guildId, userId, slot) {
        return await this.removeSlot(guildId, userId, slot);
    }

    async removeOld(userId) {
        return this.remove('global', userId, 1);
    }

    has(guildId, userId, slot) {
        const cacheKey = this.makeCacheKey(guildId, userId, slot);
        return this.cache.has(cacheKey);
    }

    hasOld(userId) {
        return this.has('global', userId, 1);
    }

    getUserSlots(guildId, userId) {
        const slots = [];
        for (let i = 1; i <= 5; i++) {
            if (this.has(guildId, userId, i)) slots.push(i);
        }
        return slots;
    }

    countUserSlots(guildId, userId) {
        return this.getUserSlots(guildId, userId).length;
    }

    get size() {
        return this.cache.size;
    }
}

export function createTokenStore(secret) {
    const sec = secret || process.env.TOKEN_ENCRYPTION_SECRET || process.env.DISCORD_TOKEN || 'default-secret';
    return new TokenStore(sec);
}

export function makeTokenStore(secret) {
    return createTokenStore(secret);
}
