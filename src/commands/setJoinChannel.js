/**
 * setJoinChannel.js - Set Welcome / Join Channel per Server
 * Location: src/commands/setJoinChannel.js
 */

import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getCollection } from '../utils/mongo.js';

export const setJoinChannelCmd = {
    data: new SlashCommandBuilder()
        .setName('setjoinchannel')
        .setDescription('Set the server welcome/join channel')
        .addChannelOption(o => 
            o.setName('channel')
             .setDescription('Select the join channel')
             .addChannelTypes(ChannelType.GuildText)
             .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: ['setjoin', 'setjoinchannel'],

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        // Fixed collection name to match inviteTracker.js ('guildSettings')
        const col = await getCollection('guildSettings');

        if (!col) return interaction.reply({ content: '❌ Database error!', ephemeral: true });

        await col.updateOne(
            { guildId: interaction.guild.id },
            { $set: { joinChannelId: channel.id, updatedAt: new Date() } },
            { upsert: true }
        );

        await interaction.reply({ content: `✅ Successfully set join channel to <#${channel.id}>!`, ephemeral: true });
    },

    async prefixExecute(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ You need `Manage Guild` permissions to use this command.');
        }

        const channel = message.mentions.channels.first();
        if (!channel) {
            return message.reply('Usage: `?setjoin #channel`');
        }

        // Fixed collection name to match inviteTracker.js ('guildSettings')
        const col = await getCollection('guildSettings');
        if (!col) return message.reply('❌ Database error!');

        await col.updateOne(
            { guildId: message.guild.id },
            { $set: { joinChannelId: channel.id, updatedAt: new Date() } },
            { upsert: true }
        );

        await message.reply(`✅ Successfully set join channel to <#${channel.id}>!`);
    }
};
