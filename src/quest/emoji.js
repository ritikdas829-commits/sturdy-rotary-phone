/**
 * emoji.js — Professional MongoDB Emoji Manager with In-Memory Caching
 * Location: src/quest/emoji.js
 */

import mongoose from 'mongoose';

// UPGRADED SCHEMA — Guild-aware + Indexed for high performance
const questEmojiSchema = new mongoose.Schema({
    guildId: { type: String, default: 'global', index: true },
    key: { type: String, required: true, index: true },
    value: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
});

questEmojiSchema.index({ guildId: 1, key: 1 }, { unique: true });

const EmojiModel = mongoose.models.QuestEmoji || mongoose.model('QuestEmoji', questEmojiSchema);

const DEFAULT_EMOJIS = {
    list: "<:list:1562284923870650570>",
    links: "<a:links:1562284922058834052>",
    emoji_15: "<a:emoji_15:1561626842539229235>",
    qdiamond: "<:qdiamond:1561994071302479913>",
    loading: "<a:SA_CH_IconLoading:1561693801209274368>",
    orbs: "<:orbs:1551629656946507837>",
    announce: "<a:announce:1486435765838942289>",
    s_admin: "<a:s_admin:1561693808670806067>",
    online: "<a:online:1561693806846410842>",
    gift: "<:GO_RedGiveaway:1561693805428740236>",
    warn: "<:Warn:1561693802412900394>",
    arrow: "<a:arrow_53:1551629637535408259>",
    dot: "<a:spider_red_dot:1562113229251936396>",
};

export class EmojiStore {
    constructor() {
        this.cache = new Map();
        this.loadIntoCache();
    }

    makeCacheKey(guildId, key) {
        return `${guildId}_${key}`;
    }

    async loadIntoCache() {
        try {
            const docs = await EmojiModel.find({});
            for (const doc of docs) {
                const cacheKey = this.makeCacheKey(doc.guildId, doc.key);
                this.cache.set(cacheKey, doc.value);
            }
            console.log(`🎨 Loaded ${docs.length} custom emoji(s) into memory cache.`);
        } catch (err) {
            console.error('❌ Error loading emojis into cache:', err.message);
        }
    }

    // ── CORE METHODS ──

    async getEmojis(guildId = 'global') {
        try {
            const customEmojis = {};
            for (const [cacheKey, value] of this.cache.entries()) {
                if (cacheKey.startsWith(`${guildId}_`) || cacheKey.startsWith(`global_`)) {
                    const key = cacheKey.split('_').slice(1).join('_');
                    customEmojis[key] = value;
                }
            }
            return { ...DEFAULT_EMOJIS, ...customEmojis };
        } catch (e) {
            console.error('❌ Error fetching emojis:', e.message);
            return DEFAULT_EMOJIS;
        }
    }

    async saveEmoji(key, value, guildId = 'global') {
        try {
            if (!key || !value) return false;

            const cacheKey = this.makeCacheKey(guildId, key);
            this.cache.set(cacheKey, value);

            await EmojiModel.findOneAndUpdate(
                { guildId, key },
                { value, updatedAt: new Date() },
                { upsert: true, new: true }
            );

            console.log(`✅ Emoji saved [${guildId}] ${key} -> ${value}`);
            return true;
        } catch (e) {
            console.error(`❌ Error saving emoji [${guildId}] ${key}:`, e.message);
            return false;
        }
    }
}

// Export a singleton instance similar to standard token stores
export const emojiStore = new EmojiStore();

export async function getEmojis(guildId = 'global') {
    return await emojiStore.getEmojis(guildId);
}

export async function saveEmoji(key, value, guildId = 'global') {
    return await emojiStore.saveEmoji(key, value, guildId);
}
