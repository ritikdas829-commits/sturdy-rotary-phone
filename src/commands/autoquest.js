/**
 * autoquest.js — Autoquest Command Handler
 * Location: src/commands/autoquest.js
 */

import { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';
import { enableAutoquest, disableAutoquest, isAutoquestEnabled, canUseAutoquest } from '../quest/autoquestStore.js';
import { PREFIX } from '../utils/config.js';

async function getActiveToken(guildId, userId, tokenStore) { 
    const active = await tokenStore.getActiveSlot(guildId, userId); 
    if (!active) return null; 
    return active.token || await tokenStore.get(guildId, userId, active.slot); 
}

async function runAutoquestToggle(guildId, userId, member, tokenStore, replyFn, prefix) {
    // Booster / Invite Check
    const check = await canUseAutoquest(member); 
    if (!check.allowed) { 
        const lock = check.lock; 
        const c = new ContainerBuilder().setAccentColor(0xFEE75C); 
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${lock.title}\n\n${lock.desc}`)); 
        await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); 
        return; 
    }

    // Toggle Off
    if (isAutoquestEnabled(userId)) { 
        disableAutoquest(userId); 
        const c = new ContainerBuilder().setAccentColor(0xFEE75C); 
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🤖 Auto-Quest Disabled`)); 
        await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }); 
        return; 
    }

    // Check Active Slot Token
    const token = await getActiveToken(guildId, userId, tokenStore); 
    if (!token) { 
        const c = new ContainerBuilder().setAccentColor(0xED4245); 
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ No Token\nUse \`${prefix}link\``)); 
        await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 }); 
        return; 
    }

    // Toggle On
    enableAutoquest(userId); 
    const c = new ContainerBuilder().setAccentColor(0x57F287); 
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🤖 Auto-Quest Enabled!\nEvery new quest will be auto-completed for you!`)); 
    await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

export const autoquestCmd = {
    data: new SlashCommandBuilder()
        .setName('autoquest')
        .setDescription('Auto-quest Booster - 15 Invite OR Boost Requirement'),
    prefix: 'autoquest',

    async execute(i, client) { 
        await i.deferReply({ flags: 64 }); 
        await runAutoquestToggle(i.guild.id, i.user.id, i.member, client.tokenStore, (o) => i.editReply(o), PREFIX); 
    },

    async prefixExecute(m, _, client) { 
        await runAutoquestToggle(m.guild.id, m.author.id, m.member, client.tokenStore, (o) => m.reply(o), PREFIX); 
    }
};
