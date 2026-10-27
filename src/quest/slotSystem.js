/**
 * slotSystem.js - Progressive Slot Display (Step-by-Step Unlock)
 * Location: src/quest/slotSystem.js
 */

import { getRoles } from './roleStore.js';
import { getUserInvites } from '../handlers/inviteTracker.js';

export const SLOTS = {
    1: { label: 'Free Slot', need: 'Free', invites: 0, boosts: 0 },
    2: { label: '2 Invite Slot', need: '2 Invites', invites: 2, boosts: 0 },
    3: { label: '5 Invite Slot', need: '5 Invites', invites: 5, boosts: 0 },
    4: { label: '10 Invite OR 1 Boost Slot', need: '10 Invites OR 1 Boost', invites: 10, boosts: 1 },
    5: { label: '2 Boost Slot', need: '2 Boosts', invites: 0, boosts: 2 },
};

export async function getCounts(member) {
    try {
        if (!member || !member.guild) return { invites: 0, boosts: 0 };

        const guildId = member.guild.id;
        const userId = member.id;

        // Fetch real-time invites from MongoDB via inviteTracker
        let invites = await getUserInvites(userId, guildId);

        let boosts = 0;
        const roles = getRoles(guildId);
        
        if (member.premiumSince) boosts = 1;
        if (roles.ROLE_1_BOOST && member.roles.cache.has(roles.ROLE_1_BOOST)) boosts = Math.max(boosts, 1);
        if (roles.ROLE_2_BOOST && member.roles.cache.has(roles.ROLE_2_BOOST)) boosts = 2;

        // Fallback role checks if DB invites are lower
        if (roles.ROLE_2_BOOST && member.roles.cache.has(roles.ROLE_2_BOOST)) invites = Math.max(invites, 10);
        else if (roles.ROLE_1_BOOST && member.roles.cache.has(roles.ROLE_1_BOOST)) invites = Math.max(invites, 10);
        else if (roles.ROLE_5_INVITES && member.roles.cache.has(roles.ROLE_5_INVITES)) invites = Math.max(invites, 5);
        else if (roles.ROLE_2_INVITES && member.roles.cache.has(roles.ROLE_2_INVITES)) invites = Math.max(invites, 2);

        return { invites, boosts };
    } catch (err) {
        console.error("getCounts error:", err.message);
        return { invites: 0, boosts: 0 };
    }
}

export async function getProgressiveSlots(member) {
    try {
        const guildId = member?.guild?.id || 'global';
        const roles = getRoles(guildId);
        const { invites, boosts } = await getCounts(member);
        
        const hasRole2 = invites >= 2 || (roles.ROLE_2_INVITES && member?.roles?.cache?.has(roles.ROLE_2_INVITES));
        const hasRole5 = invites >= 5 || (roles.ROLE_5_INVITES && member?.roles?.cache?.has(roles.ROLE_5_INVITES));
        const hasBoost1 = invites >= 10 || boosts >= 1 || (roles.ROLE_1_BOOST && member?.roles?.cache?.has(roles.ROLE_1_BOOST));
        const hasBoost2 = boosts >= 2 || (roles.ROLE_2_BOOST && member?.roles?.cache?.has(roles.ROLE_2_BOOST));

        // Kitne slots currently fully unlocked hain
        let unlockedCount = 1;
        if (hasRole2) unlockedCount = 2;
        if (hasRole5) unlockedCount = 3;
        if (hasBoost1) unlockedCount = 4;
        if (hasBoost2) unlockedCount = 5;

        // Panel me kitne slots render karne hain: Unlocked + 1 Next Locked Slot
        const slotsToShow = Math.min(5, unlockedCount + (unlockedCount < 5 ? 1 : 0));

        const slots = [];
        for (let i = 1; i <= slotsToShow; i++) {
            let can = false;
            let reason = '';
            let needRoleId = '';

            if (i === 1) {
                can = true;
                reason = 'Free - Always unlocked';
            } else if (i === 2) {
                can = hasRole2;
                needRoleId = roles.ROLE_2_INVITES || '';
                reason = hasRole2 ? 'Unlocked (2 Invites)' : `Need 2 Invites (You have ${invites}/2)`;
            } else if (i === 3) {
                can = hasRole5;
                needRoleId = roles.ROLE_5_INVITES || '';
                reason = hasRole5 ? 'Unlocked (5 Invites)' : `Need 5 Invites (You have ${invites}/5)`;
            } else if (i === 4) {
                can = hasBoost1;
                needRoleId = roles.ROLE_1_BOOST || '';
                reason = hasBoost1 ? 'Unlocked (10 Invites or 1 Boost)' : `Need 10 Invites or 1 Boost (You have ${invites}/10 invites, ${boosts}/1 boost)`;
            } else if (i === 5) {
                can = hasBoost2;
                needRoleId = roles.ROLE_2_BOOST || '';
                reason = hasBoost2 ? 'Unlocked (2 Boosts - Full Access)' : `Need 2 Boosts (You have ${boosts}/2 boosts)`;
            }

            slots.push({
                slot: i,
                ...SLOTS[i],
                can,
                reason,
                needRoleId,
                currentInvites: invites,
                currentBoosts: boosts,
            });
        }

        return { slots, invites, boosts, slotsToShow, hasRole2, hasRole5, hasBoost1, hasBoost2, roles };
    } catch (err) {
        console.error("getProgressiveSlots error:", err.message);
        return { 
            slots: [{ slot: 1, ...SLOTS[1], can: true, reason: 'Free', needRoleId: '', currentInvites: 0, currentBoosts: 0 }], 
            invites: 0, boosts: 0, slotsToShow: 1, hasRole2: false, hasRole5: false, hasBoost1: false, hasBoost2: false, roles: getRoles() 
        };
    }
}

export async function getMaxVisibleSlots(guild, userId) {
    try {
        if (!guild) return 1;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return 1;
        
        const { invites, boosts } = await getCounts(member);
        let max = 1;
        if (invites >= 2) max = 2;
        if (invites >= 5) max = 3;
        if (invites >= 10 || boosts >= 1) max = 4;
        if (boosts >= 2) max = 5;
        return max;
    } catch { return 1; }
}
