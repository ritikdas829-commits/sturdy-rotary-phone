/**
 * linkGuard.js - Link Check Guard (5-Slot MongoDB Integrated)
 * Location: src/quest/linkGuard.js
 * If user not linked and uses any command, show premium link panel
 * Until linked, quest will not run
 */

import { buildPremiumLinkPanel } from '../commands/premiumLink.js';

export async function hasAnyLinkedSlot(guildId, userId, tokenStore) {
    try {
        if (!tokenStore || typeof tokenStore.getAllSlots !== 'function') return false;
        const slots = await tokenStore.getAllSlots(guildId, userId);
        return Array.isArray(slots) && slots.length > 0;
    } catch {
        return false;
    }
}

export async function getLinkedSlotsCount(guildId, userId, tokenStore) {
    try {
        if (!tokenStore || typeof tokenStore.getAllSlots !== 'function') return 0;
        const slots = await tokenStore.getAllSlots(guildId, userId);
        return Array.isArray(slots) ? slots.length : 0;
    } catch {
        return 0;
    }
}

export async function requireLink(guildId, member, tokenStore, client, commandName = 'quest') {
    const userId = member.id || member.user?.id;
    const hasLinked = await hasAnyLinkedSlot(guildId, userId, tokenStore);

    if (!hasLinked) {
        const panel = await buildPremiumLinkPanel(guildId, userId, tokenStore, client);
        return {
            linked: false,
            hasLinked: false,
            panel: panel,
            message: `❌ Link Required — Please link an account slot first using \`/link\` before running \`${commandName}\`.`,
        };
    }

    return {
        linked: true,
        hasLinked: true,
        panel: null,
        message: null,
    };
}

export async function requireLinkForQuest(guildId, member, tokenStore, client) {
    return await requireLink(guildId, member, tokenStore, client, 'quest');
}

export function withLinkGuard(commandExecute) {
    return async (interaction, client, ...args) => {
        const guildId = interaction.guild?.id;
        const member = interaction.member || interaction.user;
        const check = await requireLink(guildId, member, client.tokenStore, client, interaction.commandName || 'command');
        
        if (!check.linked) {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ ...check.panel, ephemeral: true }).catch(()=>{});
            } else {
                await interaction.reply({ ...check.panel, ephemeral: true }).catch(async () => {
                    await interaction.reply({ content: check.message, ephemeral: true }).catch(()=>{});
                });
            }
            return;
        }
        return await commandExecute(interaction, client, ...args);
    };
}

export function withLinkGuardPrefix(prefixExecute) {
    return async (message, args, client, ...rest) => {
        const guildId = message.guild?.id;
        const member = message.member || message.author;
        const check = await requireLink(guildId, member, client.tokenStore, client, 'quest');
        
        if (!check.linked) {
            await message.reply({ ...check.panel }).catch(async () => {
                await message.reply(check.message).catch(()=>{});
            });
            return;
        }
        return await prefixExecute(message, args, client, ...rest);
    };
}
