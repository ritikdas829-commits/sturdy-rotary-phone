/**
 * quest.js — Quest Command Handler (Fixed Error Handling)
 * Location: src/commands/quest.js
 */

import { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } from 'discord.js';

export const questCmd = {
    data: new SlashCommandBuilder()
        .setName('quest')
        .setDescription('Quest Solver - Banner + SelectMenu + Rewards'),
    prefix: 'quest',

    async execute(interaction, client) { 
        try {
            await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 }); 
            const { buildQuestSolverPanel } = await import('../quest/questUI.js'); 
            const panel = await buildQuestSolverPanel(client, interaction.guild.id, interaction.user.id); 
            await interaction.editReply(panel); 
        } catch (err) {
            console.error('[Error in quest slash cmd]:', err);
            const errCard = new ContainerBuilder().setAccentColor(0xED4245);
            errCard.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ Error\n${err.message || 'Failed to load quest solver panel.'}`));
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ components: [errCard], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            } else {
                await interaction.reply({ components: [errCard], flags: MessageFlags.IsComponentsV2, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async prefixExecute(message, _args, client) { 
        try {
            await message.channel.sendTyping().catch(() => {});
            const { buildQuestSolverPanel } = await import('../quest/questUI.js'); 
            const panel = await buildQuestSolverPanel(client, message.guild.id, message.author.id); 
            await message.reply(panel); 
        } catch (err) {
            console.error('[Error in ?quest prefix cmd]:', err);
            const errCard = new ContainerBuilder().setAccentColor(0xED4245);
            errCard.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ Quest Solver Error\n${err.message || 'Failed to load quest solver panel.'}`));
            await message.reply({ components: [errCard], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    }
};
