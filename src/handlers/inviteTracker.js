/**
 * inviteTracker.js - Robust Multi-Server Invite Tracker
 * Strict Rules: Account Age >= 7 Days, Rejoin Window >= 14 Days
 */

import { getCollection, getDatabase } from '../utils/mongo.js';
import { getRoles } from '../quest/roleStore.js';

const COLLECTION_INVITES = 'invites_data';

const memoryCache = new Map();
let isCacheLoaded = false;
const dmCooldown = new Set();
const invitesCache = new Map();

async function preloadCache() {
    try {
        const col = await getCollection(COLLECTION_INVITES);
        if (!col) return;
        const allDocs = await col.find({}).toArray();
        allDocs.forEach(doc => {
            const key = `${doc.guildId}_${doc.userId}`;
            memoryCache.set(key, {
                count: doc.count || 0,
                invitedUsers: doc.invitedUsers || [],
                leaveHistory: doc.leaveHistory || {}
            });
        });
        isCacheLoaded = true;
        console.log(`⚡ Invite cache loaded - ${memoryCache.size} entries - Multi Server`);
    } catch (err) {
        console.error("Invite preload error:", err.message);
    }
}

async function saveUserDB(guildId, userId, data) {
    const cacheKey = `${guildId}_${userId}`;
    memoryCache.set(cacheKey, data);
    try {
        const col = await getCollection(COLLECTION_INVITES);
        if (!col) return;
        await col.updateOne(
            { guildId, userId },
            { 
                $set: { 
                    guildId, 
                    userId, 
                    count: data.count || 0, 
                    invitedUsers: data.invitedUsers || [], 
                    leaveHistory: data.leaveHistory || {}, 
                    updatedAt: new Date() 
                } 
            },
            { upsert: true }
        );
    } catch (err) {
        console.error(`Save error ${userId}:`, err.message);
    }
}

export async function getUserInvites(userId, guildId) {
    if (!guildId) return 0;
    const cacheKey = `${guildId}_${userId}`;
    if (!isCacheLoaded) await preloadCache();
    if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey).count || 0;
    try {
        const col = await getCollection(COLLECTION_INVITES);
        if (!col) return 0;
        const doc = await col.findOne({ guildId, userId });
        if (doc) {
            memoryCache.set(cacheKey, { 
                count: doc.count || 0, 
                invitedUsers: doc.invitedUsers || [], 
                leaveHistory: doc.leaveHistory || {} 
            });
            return doc.count || 0;
        }
    } catch (err) {
        console.error(`Fetch invites error ${userId}:`, err.message);
    }
    return 0;
}

function getTargetRoles(guild) {
    try {
        const stored = getRoles(guild.id);
        const roles = {};
        if (stored?.ROLE_2_INVITES) {
            const r = guild.roles.cache.get(stored.ROLE_2_INVITES);
            if (r) roles.ROLE_2_INVITES = r;
        }
        if (stored?.ROLE_5_INVITES) {
            const r = guild.roles.cache.get(stored.ROLE_5_INVITES);
            if (r) roles.ROLE_5_INVITES = r;
        }
        if (stored?.ROLE_10_INVITES) {
            const r = guild.roles.cache.get(stored.ROLE_10_INVITES);
            if (r) roles.ROLE_10_INVITES = r;
        }
        return roles;
    } catch {
        return {};
    }
}

async function getLogChannel(guild, type) {
    try {
        const db = await getDatabase();
        if (!db) return null;
        const col = db.collection('guildSettings');
        const settings = await col.findOne({ guildId: guild.id });
        if (!settings) return null;
        const channelId = type === 'join' ? settings.joinChannelId : settings.leaveChannelId;
        if (!channelId) return null;
        return await guild.channels.fetch(channelId).catch(() => null);
    } catch { 
        return null; 
    }
}

export async function cacheGuildInvites(client) {
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const guildInvites = await guild.invites.fetch().catch(() => null);
            if (!guildInvites) continue;
            const inviteMap = new Map(guildInvites.map(i => [i.code, i.uses]));

            if (guild.features?.includes('VANITY_URL') && guild.vanityURLCode) {
                const vanityData = await guild.fetchVanityData().catch(() => null);
                if (vanityData) inviteMap.set(`vanity_${vanityData.code}`, vanityData.uses);
            }
            invitesCache.set(guildId, inviteMap);
        } catch (err) {
            console.error(`Fetch invites failed for ${guild.name}:`, err.message);
        }
    }
    await preloadCache();
}

export async function handleInviteJoin(member) {
    if (!member || member.user.bot) return;
    const guild = member.guild;
    const cachedInvites = invitesCache.get(guild.id) || new Map();
    const joinChannel = await getLogChannel(guild, 'join');

    try {
        const newInvites = await guild.invites.fetch().catch(() => null);
        if (!newInvites) return;

        let usedInvite = null;
        let isVanity = false;

        for (const [code, invite] of newInvites) {
            const cachedUses = cachedInvites.get(code) || 0;
            if (invite.uses > cachedUses) {
                usedInvite = invite;
                break;
            }
        }

        if (!usedInvite && guild.features?.includes('VANITY_URL') && guild.vanityURLCode) {
            const vanityData = await guild.fetchVanityData().catch(() => null);
            const cachedVanity = cachedInvites.get(`vanity_${guild.vanityURLCode}`) || 0;
            if (vanityData && vanityData.uses > cachedVanity) {
                isVanity = true;
            }
        }

        const newMap = new Map(newInvites.map(i => [i.code, i.uses]));
        if (guild.features?.includes('VANITY_URL') && guild.vanityURLCode) {
            const vData = await guild.fetchVanityData().catch(() => null);
            if (vData) newMap.set(`vanity_${vData.code}`, vData.uses);
        }
        invitesCache.set(guild.id, newMap);

        if (isVanity) {
            memoryCache.set(`vanity_joined_${member.id}`, { isVanity: true });
            if (joinChannel) await joinChannel.send(`📥 <@${member.id}> joined using Vanity URL!`).catch(() => {});
            return;
        }

        if (!usedInvite?.inviter) return;
        const inviter = usedInvite.inviter;
        if (inviter.id === member.user.id) return; // Self invite ignored

        const cacheKey = `${guild.id}_${inviter.id}`;
        if (!memoryCache.has(cacheKey)) {
            memoryCache.set(cacheKey, { count: 0, invitedUsers: [], leaveHistory: {} });
        }
        let inviterData = memoryCache.get(cacheKey);

        const now = Date.now();

        // ── STRICT RULE 1: Rejoin within 14 days check ──
        if (inviterData.leaveHistory?.[member.id]) {
            const timePassed = now - inviterData.leaveHistory[member.id];
            const fourteenDaysInMs = 14 * 24 * 60 * 60 * 1000;
            
            if (timePassed < fourteenDaysInMs) {
                if (joinChannel) {
                    await joinChannel.send(`⏳ <@${member.id}> rejoined within 14 days. **Not counted** for <@${inviter.id}>.`).catch(() => {});
                }
                return;
            } else {
                delete inviterData.leaveHistory[member.id];
            }
        }

        // ── STRICT RULE 2: Account age < 7 days check ──
        const accountAgeDays = (now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
        if (accountAgeDays < 7) {
            if (joinChannel) {
                await joinChannel.send(`⚠️ <@${member.id}> account is less than 7 days old (${Math.floor(accountAgeDays)} days). **Not counted** for <@${inviter.id}>.`).catch(() => {});
            }
            return;
        }

        if (!inviterData.invitedUsers.includes(member.id)) {
            inviterData.invitedUsers.push(member.id);
        }
        inviterData.count = inviterData.invitedUsers.length;
        await saveUserDB(guild.id, inviter.id, inviterData);

        if (joinChannel) {
            await joinChannel.send(`📥 <@${member.id}> joined! Invited by <@${inviter.id}> (**${inviterData.count}** valid invites)`).catch(() => {});
        }

        // Automatic Role Assignments
        const targetRoles = getTargetRoles(guild);
        const inviterMember = await guild.members.fetch(inviter.id).catch(() => null);
        if (!inviterMember) return;

        if (inviterData.count >= 2 && targetRoles.ROLE_2_INVITES) {
            if (!inviterMember.roles.cache.has(targetRoles.ROLE_2_INVITES.id)) {
                await inviterMember.roles.add(targetRoles.ROLE_2_INVITES).catch(() => {});
                if (joinChannel) await joinChannel.send(`🎉 <@${inviter.id}> unlocked **${targetRoles.ROLE_2_INVITES.name}**!`).catch(() => {});
            }
        }

        if (inviterData.count >= 5 && targetRoles.ROLE_5_INVITES) {
            if (!inviterMember.roles.cache.has(targetRoles.ROLE_5_INVITES.id)) {
                await inviterMember.roles.add(targetRoles.ROLE_5_INVITES).catch(() => {});
                if (joinChannel) await joinChannel.send(`🎉 <@${inviter.id}> unlocked **${targetRoles.ROLE_5_INVITES.name}**!`).catch(() => {});
            }
        }

        if (inviterData.count >= 10 && targetRoles.ROLE_10_INVITES) {
            if (!inviterMember.roles.cache.has(targetRoles.ROLE_10_INVITES.id)) {
                await inviterMember.roles.add(targetRoles.ROLE_10_INVITES).catch(() => {});
                if (joinChannel) await joinChannel.send(`🎉 <@${inviter.id}> unlocked **${targetRoles.ROLE_10_INVITES.name}**!`).catch(() => {});
            }
        }

    } catch (err) { 
        console.error("Join tracking error:", err.message); 
    }
}

export async function handleInviteLeave(member) {
    if (!member || member.user.bot) return;
    const guild = member.guild;
    const leaveChannel = await getLogChannel(guild, 'leave');

    if (memoryCache.has(`vanity_joined_${member.id}`)) {
        memoryCache.delete(`vanity_joined_${member.id}`);
        if (leaveChannel) await leaveChannel.send(`📤 <@${member.id}> left (vanity URL).`).catch(() => {});
        return;
    }

    let inviterId = null;
    let inviterData = null;

    for (const [key, data] of memoryCache.entries()) {
        if (!key.startsWith(`${guild.id}_`)) continue;
        if (data.invitedUsers?.includes(member.id)) {
            const parts = key.split('_');
            inviterId = parts[1];
            inviterData = data;
            break;
        }
    }

    if (!inviterData) {
        try {
            const col = await getCollection(COLLECTION_INVITES);
            if (col) {
                const doc = await col.findOne({ guildId: guild.id, invitedUsers: member.id });
                if (doc) {
                    inviterId = doc.userId;
                    inviterData = { 
                        count: doc.count || 0, 
                        invitedUsers: doc.invitedUsers || [], 
                        leaveHistory: doc.leaveHistory || {} 
                    };
                    memoryCache.set(`${guild.id}_${inviterId}`, inviterData);
                }
            }
        } catch (e) { 
            console.error("DB fallback error:", e.message); 
        }
    }

    if (inviterId && inviterData) {
        inviterData.invitedUsers = inviterData.invitedUsers.filter(id => id !== member.id);
        inviterData.count = inviterData.invitedUsers.length;
        if (!inviterData.leaveHistory) inviterData.leaveHistory = {};
        inviterData.leaveHistory[member.id] = Date.now();
        await saveUserDB(guild.id, inviterId, inviterData);

        if (leaveChannel) {
            await leaveChannel.send(`📤 <@${member.id}> left. Invited by <@${inviterId}> (Remaining valid invites: **${inviterData.count}**)`).catch(() => {});
        }

        const targetRoles = getTargetRoles(guild);
        const inviterMember = await guild.members.fetch(inviterId).catch(() => null);

        if (inviterMember) {
            if (inviterData.count < 10 && targetRoles.ROLE_10_INVITES && inviterMember.roles.cache.has(targetRoles.ROLE_10_INVITES.id)) {
                await inviterMember.roles.remove(targetRoles.ROLE_10_INVITES).catch(() => {});
                if (leaveChannel) await leaveChannel.send(`🔒 <@${inviterId}> lost **${targetRoles.ROLE_10_INVITES.name}**`).catch(() => {});
            }
            if (inviterData.count < 5 && targetRoles.ROLE_5_INVITES && inviterMember.roles.cache.has(targetRoles.ROLE_5_INVITES.id)) {
                await inviterMember.roles.remove(targetRoles.ROLE_5_INVITES).catch(() => {});
                if (leaveChannel) await leaveChannel.send(`🔒 <@${inviterId}> lost **${targetRoles.ROLE_5_INVITES.name}**`).catch(() => {});
            }
            if (inviterData.count < 2 && targetRoles.ROLE_2_INVITES && inviterMember.roles.cache.has(targetRoles.ROLE_2_INVITES.id)) {
                await inviterMember.roles.remove(targetRoles.ROLE_2_INVITES).catch(() => {});
                if (leaveChannel) await leaveChannel.send(`🔒 <@${inviterId}> lost **${targetRoles.ROLE_2_INVITES.name}**`).catch(() => {});
            }
        }
    }
}
