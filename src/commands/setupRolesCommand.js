/**
 * setupRolesCommand.js - 5 Roles Version with Async DB Fetching
 * Location: src/commands/setupRolesCommand.js
 */

import { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';
import { getRolesAsync, setRole, removeRole, syncRolesFromDB } from '../quest/roleStore.js';

export const data = new SlashCommandBuilder()
    .setName('setuproles')
    .setDescription('Setup 5 roles for progressive slots — Per guild — Multi server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub.setName('set')
            .setDescription('Set a role for progressive system')
            .addStringOption(opt =>
                opt.setName('key')
                    .setDescription('Which role slot — 5 roles')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Role 1 — 2 Invites (Slot 2)', value: 'ROLE_2_INVITES' },
                        { name: 'Role 2 — 5 Invites (Slot 3)', value: 'ROLE_5_INVITES' },
                        { name: 'Role 3 — 10 Invites (Slot 4)', value: 'ROLE_10_INVITES' },
                        { name: 'Role 4 — 1 Boost (Slot 4 Boost)', value: 'ROLE_1_BOOST' },
                        { name: 'Role 5 — 2 Boosts (Slot 5 Full)', value: 'ROLE_2_BOOST' },
                    )
            )
            .addRoleOption(opt =>
                opt.setName('role')
                    .setDescription('Select role to set')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('remove')
            .setDescription('Remove a role')
            .addStringOption(opt =>
                opt.setName('key')
                    .setDescription('Which role to remove')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Role 1 — 2 Invites', value: 'ROLE_2_INVITES' },
                        { name: 'Role 2 — 5 Invites', value: 'ROLE_5_INVITES' },
                        { name: 'Role 3 — 10 Invites', value: 'ROLE_10_INVITES' },
                        { name: 'Role 4 — 1 Boost', value: 'ROLE_1_BOOST' },
                        { name: 'Role 5 — 2 Boosts', value: 'ROLE_2_BOOST' },
                    )
            )
    )
    .addSubcommand(sub =>
        sub.setName('view')
            .setDescription('View current 5 roles')
    )
    .addSubcommand(sub =>
        sub.setName('sync')
            .setDescription('Sync roles from MongoDB')
    );

export async function execute(interaction) {
    try {
        const guildId = interaction.guild.id;
        const sub = interaction.options.getSubcommand();

        if (sub === 'view') {
            await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
            const roles = await getRolesAsync(guildId);
            const c = new ContainerBuilder().setAccentColor(0x5865F2);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ⚙️ SetupRoles — Current 5 Roles — ${interaction.guild.name}\n` +
                `**GuildId:** ${guildId}\n\n` +
                `**Role 1 (2 Invites — Slot 2):** ${roles.ROLE_2_INVITES ? `<@&${roles.ROLE_2_INVITES}>` : '❌ Not set'}\n` +
                `**Role 2 (5 Invites — Slot 3):** ${roles.ROLE_5_INVITES ? `<@&${roles.ROLE_5_INVITES}>` : '❌ Not set'}\n` +
                `**Role 3 (10 Invites — Slot 4):** ${roles.ROLE_10_INVITES ? `<@&${roles.ROLE_10_INVITES}>` : '❌ Not set'}\n` +
                `**Role 4 (1 Boost — Slot 4 Boost):** ${roles.ROLE_1_BOOST ? `<@&${roles.ROLE_1_BOOST}>` : '❌ Not set'}\n` +
                `**Role 5 (2 Boosts — Slot 5 Full):** ${roles.ROLE_2_BOOST ? `<@&${roles.ROLE_2_BOOST}>` : '❌ Not set'}\n\n` +
                `-# Use /setuproles set — To set roles`
            ));
            await interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
            return;
        }

        if (sub === 'set') {
            await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
            const key = interaction.options.getString('key');
            const role = interaction.options.getRole('role');
            await setRole(guildId, key, role.id);
            const c = new ContainerBuilder().setAccentColor(0x57F287);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ✅ Role Set Successfully\n` +
                `**Key:** ${key}\n` +
                `**Role:** ${role}\n` +
                `**Guild:** ${interaction.guild.name}`
            ));
            await interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
            return;
        }

        if (sub === 'remove') {
            await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
            const key = interaction.options.getString('key');
            await removeRole(guildId, key);
            const c = new ContainerBuilder().setAccentColor(0xED4245);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# 🗑️ Role Removed\n` +
                `**Key:** ${key} removed successfully.`
            ));
            await interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
            return;
        }

        if (sub === 'sync') {
            await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
            await syncRolesFromDB();
            const roles = await getRolesAsync(guildId);
            const c = new ContainerBuilder().setAccentColor(0x5865F2);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# 🔄 Synced from MongoDB\n` +
                `Loaded successfully!`
            ));
            await interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
            return;
        }

    } catch (err) {
        console.error("setupRolesCommand error:", err.message);
    }
}

export const setupRolesCmd = {
    data,
    execute
};
