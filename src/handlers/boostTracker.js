/**
 * boostTracker.js - Boost Role Management - MongoDB - Multi Server - No Crash
 * Location: src/handlers/boostTracker.js
 */

import { getRoles } from '../quest/roleStore.js';

function getBoostRoles(guild) {
    try {
        const stored = getRoles(guild.id);
        const roles = {};
        if (stored.ROLE_1_BOOST) {
            const r = guild.roles.cache.get(stored.ROLE_1_BOOST);
            if (r) roles.ROLE_1_BOOST = r; // Role 4: 1 Boost (Slot 4 Boost)
        }
        if (stored.ROLE_2_BOOST) {
            const r = guild.roles.cache.get(stored.ROLE_2_BOOST);
            if (r) roles.ROLE_2_BOOST = r; // Role 5: 2 Boosts (Slot 5 Full)
        }
        return roles;
    } catch {
        return {};
    }
}

function getBoostCount(member) {
    try {
        let boosts = 0;
        if (member.premiumSince) {
            boosts = 1;
            const guildBoostCount = member.guild?.premiumSubscriptionCount || 0;
            if (guildBoostCount >= 2 && member.guild.members.cache.filter(m => m.premiumSince).size === 1) {
                boosts = 2;
            }
        }
        
        const roles = getRoles(member.guild?.id);
        if (roles.ROLE_2_BOOST && member.roles.cache.has(roles.ROLE_2_BOOST)) {
            boosts = Math.max(boosts, 2);
        } else if (roles.ROLE_1_BOOST && member.roles.cache.has(roles.ROLE_1_BOOST)) {
            boosts = Math.max(boosts, 1);
        }

        return boosts;
    } catch {
        return 0;
    }
}

async function sendSafeDM(member, message) {
    try { await member.send(message); } catch {}
}

export async function handleBoostAdd(member) {
    if (!member || member.user.bot) return;
    try {
        const guild = member.guild;
        const boostRoles = getBoostRoles(guild);
        const boosts = getBoostCount(member);

        if (boosts >= 1 && boostRoles.ROLE_1_BOOST) {
            if (!member.roles.cache.has(boostRoles.ROLE_1_BOOST.id)) {
                await member.roles.add(boostRoles.ROLE_1_BOOST).catch(()=>{});
                await sendSafeDM(member, `💎 You boosted ${guild.name}! **${boostRoles.ROLE_1_BOOST.name}** unlocked - Slot 4 Boost`);
            }
        }
        if (boosts >= 2 && boostRoles.ROLE_2_BOOST) {
            if (!member.roles.cache.has(boostRoles.ROLE_2_BOOST.id)) {
                await member.roles.add(boostRoles.ROLE_2_BOOST).catch(()=>{});
                await sendSafeDM(member, `👑 Double boosted ${guild.name}! **${boostRoles.ROLE_2_BOOST.name}** unlocked - Slot 5 Full Access!`);
            }
        }
    } catch (err) {
        console.error(`Boost add error ${member.id}:`, err.message);
    }
}

export async function handleBoostRemove(member) {
    if (!member || member.user.bot) return;
    try {
        const guild = member.guild;
        const boostRoles = getBoostRoles(guild);
        const boosts = getBoostCount(member);

        if (boosts < 2 && boostRoles.ROLE_2_BOOST && member.roles.cache.has(boostRoles.ROLE_2_BOOST.id)) {
            if (!member.premiumSince || boosts < 2) {
                await member.roles.remove(boostRoles.ROLE_2_BOOST).catch(()=>{});
            }
        }
        if (boosts < 1 && boostRoles.ROLE_1_BOOST && member.roles.cache.has(boostRoles.ROLE_1_BOOST.id)) {
            if (!member.premiumSince) {
                await member.roles.remove(boostRoles.ROLE_1_BOOST).catch(()=>{});
            }
        }
    } catch (err) {
        console.error(`Boost remove error ${member.id}:`, err.message);
    }
}

export async function handleBoostUpdate(oldMember, newMember) {
    if (!oldMember || !newMember || newMember.user.bot) return;
    try {
        const hadBoost = Boolean(oldMember.premiumSince);
        const hasBoost = Boolean(newMember.premiumSince);
        
        if (!hadBoost && hasBoost) {
            await handleBoostAdd(newMember);
        } else if (hadBoost && !hasBoost) {
            await handleBoostRemove(newMember);
        } else if (hadBoost && hasBoost) {
            const oldBoosts = getBoostCount(oldMember);
            const newBoosts = getBoostCount(newMember);
            if (newBoosts > oldBoosts) {
                await handleBoostAdd(newMember);
            } else if (newBoosts < oldBoosts) {
                await handleBoostRemove(newMember);
            }
        }
    } catch (err) {
        console.error("Boost update error:", err.message);
    }
}
