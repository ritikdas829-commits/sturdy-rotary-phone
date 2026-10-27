/**
 * autoquestRunner.js — Background AutoQuest Checker & Runner — FIXED
 * Location: src/quest/autoquestRunner.js
 */

import { getAutoquestUsers, isBooster, disableAutoquest } from './autoquestStore.js';
import { QuestClient } from './questClient.js';
import { Quest } from './quest.js';

async function runAutoquestForUser(userId, quest, tokenStore, client, guildId, prefix = ';') {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;
        
        // 15 Invite OR 1 Boost check
        if (!await isBooster(member)) return;

        const active = await tokenStore.getActiveSlot(guildId, userId);
        if (!active) return;
        const token = active.token || await tokenStore.get(guildId, userId, active.slot);
        if (!token) return;

        const qc = new QuestClient(token);
        let manager = await qc.fetchQuests();
        let live = manager.get(quest.id);
        if (!live) {
            live = Quest.create({ 
                id: quest.id, 
                config: quest.config, 
                user_status: null, 
                targeted_content: quest.targetedContent, 
                preview: quest.preview 
            });
        }
        
        // Already completed ya expired hai toh skip
        if (live.isCompleted?.() || live.isExpired?.() || live.user_status?.completed_at) return;
        
        const logs = [];
        await manager.doingQuest(live, (m) => logs.push(m));
        await manager.claimRewards((m) => logs.push(m), live.id).catch(() => 0);
        
    } catch (err) {
        console.error('[AutoQuestRunner] User error:', userId, err.message);
        if (err.message.includes('401')) {
            const active = await tokenStore.getActiveSlot(guildId, userId);
            if (active) await tokenStore.removeSlot(guildId, userId, active.slot);
            disableAutoquest(userId);
        }
    }
}

export async function checkAndRunAutoquests(client, guildId, prefix = ';') {
    const userIds = getAutoquestUsers();
    if (!userIds || userIds.length === 0) return;

    try {
        const tokenStore = client.tokenStore;
        if (!tokenStore) return;

        for (const userId of userIds) {
            const active = await tokenStore.getActiveSlot(guildId, userId);
            if (!active) continue;
            
            const token = active.token || await tokenStore.get(guildId, userId, active.slot);
            if (!token) continue;

            const qc = new QuestClient(token);
            const manager = await qc.fetchQuests();
            
            // FIX: list() se lo aur uncompleted/unexpired quests filter karo
            const allQuests = manager.list();
            const validQuests = allQuests.filter(q => {
                const isDone = q.isCompleted?.() || q.user_status?.completed_at;
                const isExpired = q.isExpired?.();
                return !isDone && !isExpired;
            });

            for (const quest of validQuests) {
                await runAutoquestForUser(userId, quest, tokenStore, client, guildId, prefix);
                // Rate-limit se bachne ke liye 1.5 second ka delay
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    } catch (err) {
        console.error('[AutoQuestRunner] Error checking quests:', err.message);
    }
}
