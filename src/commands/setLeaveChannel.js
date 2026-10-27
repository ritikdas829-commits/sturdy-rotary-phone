/**
 * setLeaveChannel.js - Set Leave Channel per Server
 * Location: src/commands/setLeaveChannel.js
 */

import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getCollection } from '../utils/mongo.js';

export const setLeaveChannelCmd = {
    data: new SlashCommandBuilder()
        .setName('setleavechannel')
        .setDescription('Set the server leave channel')
        .addChannelOption(o => 
            o.setName('channel')
             .setDescription('Select the leave channel')
             .addChannelTypes(ChannelType.GuildText)
             .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: ['setleave', 'setleavechannel'],

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        // Fixed collection name to match guildSettings
        const col = await getCollection('guildSettings');

        if (!col) return interaction.reply({ content: '❌ Database error!', ephemeral: true });

        await col.updateOne(
            { guildId: interaction.guild.id },
            { $set: { leaveChannelId: channel.id, updatedAt: new Date() } },
            { upsert: true }
        );

        await interaction.reply({ content: `✅ Successfully set leave channel to <#${channel.id}>!`, ephemeral: true });
    },

    async prefixExecute(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ You need `Manage Guild` permissions to use this command.');
        }

        const channel = message.mentions.channels.first();
        if (!channel) {
            return message.reply('Usage: `?setleave #channel`');
        }

        // Fixed collection name to match guildSettings
        const col = await getCollection('guildSettings');
        if (!col) return message.reply('❌ Database error!');

        await col.updateOne(
            { guildId: message.guild.id },
            { $set: { leaveChannelId: channel.id, updatedAt: new Date() } },
            { upsert: true }
        );

        await message.reply(`✅ Successfully set leave channel to <#${channel.id}>!`);
    }
};
