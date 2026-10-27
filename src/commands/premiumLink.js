/**
 * premiumLink.js - Fixed Formatting & Clean UI Panel - FINAL
 * Location: src/commands/premiumLink.js
 */

import {
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, 
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, 
    MessageFlags, SlashCommandBuilder,
} from 'discord.js';
import { getProgressiveSlots } from '../quest/slotSystem.js';

const SUPPORT_SERVER = 'https://discord.gg/y5f29e5tQb';

function getClientPrefix(client, guildId) {
    try {
        if (client?.getPrefix) return client.getPrefix(guildId);
        if (client?.config?.prefix) return client.config.prefix;
        if (client?.prefix) return client.prefix;
    } catch {}
    return process.env.BOT_PREFIX || ';';
}

function getAccountAge(discordId) {
    try {
        if (!discordId) return 'N/A';
        const ts = Number((BigInt(discordId) >> 22n) + 1420070400000n);
        const days = Math.floor((Date.now() - ts) / 86400000);
        if (days < 30) return `${days} days ago`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months} months ago`;
        return `${Math.floor(months/12)} years ago`;
    } catch { return 'N/A'; }
}

export async function buildPremiumLinkPanel(guildId, ownerId, tokenStore, client, member = null) {
    const prefix = getClientPrefix(client, guildId);
    const guildMember = member || await client.guilds.cache.get(guildId)?.members.fetch(ownerId).catch(() => null);
    const { slots, invites, boosts, slotsToShow } = await getProgressiveSlots(guildMember);

    let accounts = await tokenStore.getAllSlots(guildId, ownerId);

    if (accounts.length > 0) {
        const activeAccounts = accounts.filter(a => a.isActive);
        if (activeAccounts.length !== 1) {
            const targetActiveSlot = activeAccounts.length > 0 ? activeAccounts[0].slot : accounts[0].slot;
            await tokenStore.setActiveSlot(guildId, ownerId, targetActiveSlot);
            accounts = await tokenStore.getAllSlots(guildId, ownerId);
        }
    }

    const c1 = new ContainerBuilder().setAccentColor(0x5865F2);
    c1.addTextDisplayComponents(new TextDisplayBuilder().setContent('# Premium Link'));
    c1.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**Terms & Privacy**\nBy linking your Discord token, you allow the premium bot to use it for quest completion.\n` +
        `Use \`${prefix}guide\` for token guide. Active slot runs quests — Use \`${prefix}quest\` to run active, \`${prefix}questall\` to run all slots.\n\n` +
        `> **Invites:** ${invites} \vert{} **Boosts:**${boosts}`
    ));
    c1.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Support server: ${SUPPORT_SERVER}`));

    const c2 = new ContainerBuilder().setAccentColor(0x2B2D31);
    c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Account Panel (${slotsToShow} Visible Slots)`));

    for (let idx = 0; idx < slots.length; idx++) {
        const slotData = slots[idx];
        const slotNum = slotData.slot;
        const linked = accounts.find(a => a.slot === slotNum);

        if (!linked) {
            if (slotData.can) {
                c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### #${slotNum} Account Configuration\n` +
                    `• **User:** Not Linked (${slotData.label})\n` +
                    `• **Status:** Not Active\n` +
                    `• **Requirement:** ${slotData.need} - ✅ Unlocked\n` +
                    `• **Account Age:** N/A\n` +
                    `• **Linked At:** N/A`
                ));
                c2.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`link_slot_${slotNum}`).setLabel('Link').setStyle(ButtonStyle.Success)
                ));
            } else {
                c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### #${slotNum} Account Configuration 🔒\n` +
                    `• **User:** Locked (${slotData.label})\n` +
                    `• **Status:** Locked\n` +
                    `• **Requirement:** ${slotData.need}\n` +
                    `• **Note:** ${slotData.reason}`
                ));
                c2.addActionRowComponents(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`locked_slot_${slotNum}`).setLabel(`Locked (${slotData.need})`).setStyle(ButtonStyle.Secondary).setDisabled(true)
                ));
            }
        } else {
            const isCurrentlyActive = Boolean(linked.isActive);
            const status = isCurrentlyActive ? 'Active ✅' : 'Not Active';
            const age = getAccountAge(linked.linkedUserId);
            const linkedAt = linked.linkedAt ? new Date(linked.linkedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A';
            const avatarUrl = linked.avatar ? `https://cdn.discordapp.com/avatars/${linked.linkedUserId}/${linked.avatar}.png?size=128` : null;
            
            const content = 
                `### #${slotNum} Account Configuration\n` +
                `• **User:** ${linked.username} (\`${linked.linkedUserId || 'N/A'}\`)\n` +
                `• **Slot Type:** ${slotData.label}\n` +
                `• **Status:** ${status}\n` +
                `• **Account Age:** ${age}\n` +
                `• **Linked At:** ${linkedAt}`;
            
            if (avatarUrl) {
                c2.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content)).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl)));
            } else {
                c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            }
            
            const row = new ActionRowBuilder();
            row.addComponents(new ButtonBuilder().setCustomId(`unlink_slot_${slotNum}`).setLabel('Unlink').setStyle(ButtonStyle.Danger));
            if (!isCurrentlyActive) {
                row.addComponents(new ButtonBuilder().setCustomId(`select_slot_${slotNum}`).setLabel('Select').setStyle(ButtonStyle.Primary));
            }
            c2.addActionRowComponents(row);
        }

        if (idx < slots.length - 1) {
            c2.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        }
    }

    c2.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Active slot will run quests — Support: ${SUPPORT_SERVER}`));
    return { components: [c1, c2], flags: MessageFlags.IsComponentsV2 };
}

export function buildLinkModal(slot) {
    const m = new ModalBuilder().setCustomId(`link_modal_slot_${slot}`).setTitle(`Link Slot #${slot}`);
    m.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('token_input').setLabel('Discord Token').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Paste Discord token here...')
    ));
    return m;
}

const linkData = new SlashCommandBuilder().setName('link').setDescription('Premium Link - Progressive System');

export const linkCmd = {
    data: linkData,
    prefix: 'link',
    async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        const panel = await buildPremiumLinkPanel(interaction.guild.id, interaction.user.id, client.tokenStore, client, interaction.member);
        await interaction.editReply(panel);
    },
    async prefixExecute(message, _args, client) {
        const panel = await buildPremiumLinkPanel(message.guild.id, message.author.id, client.tokenStore, client, message.member);
        await message.reply(panel);
    }
};

export const unlinkCmd = {
    data: new SlashCommandBuilder().setName('unlink').setDescription('Unlink slot').addIntegerOption(o=>o.setName('slot').setDescription('1-5').setRequired(true).setMinValue(1).setMaxValue(5)),
    prefix: 'unlink',
    async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        const slot = interaction.options.getInteger('slot');
        await client.tokenStore.removeSlot(interaction.guild.id, interaction.user.id, slot);
        const panel = await buildPremiumLinkPanel(interaction.guild.id, interaction.user.id, client.tokenStore, client, interaction.member);
        await interaction.editReply(panel);
    },
    async prefixExecute(message, args, client) {
        const prefix = getClientPrefix(client, message.guild.id);
        const slot = parseInt(args[0]); 
        if (!slot || slot < 1 || slot > 5) return message.reply(`Usage: \`${prefix}unlink 1\``);
        await client.tokenStore.removeSlot(message.guild.id, message.author.id, slot);
        const panel = await buildPremiumLinkPanel(message.guild.id, message.author.id, client.tokenStore, client, message.member);
        await message.reply(panel);
    }
};

export async function handleButton(interaction, client) {
    const guildId = interaction.guild.id;
    const ownerId = interaction.user.id;
    const member = interaction.member;

    if (interaction.customId.startsWith('link_slot_')) {
        const slotNum = parseInt(interaction.customId.split('_')[2]);
        const prog = await getProgressiveSlots(member);
        const slotData = prog.slots.find(s => s.slot === slotNum);
        if (!slotData?.can) {
            return await interaction.reply({ 
                content: `🔒 **Slot #${slotNum} Locked!**\n**Requirement:** ${slotData?.need}\n${slotData?.reason}`, 
                flags: MessageFlags.Ephemeral 
            });
        }
        return await interaction.showModal(buildLinkModal(slotNum));
    }

    if (interaction.customId.startsWith('unlink_slot_')) {
        const slotToUnlink = parseInt(interaction.customId.split('_')[2]);
        await client.tokenStore.removeSlot(guildId, ownerId, slotToUnlink);
        const panel = await buildPremiumLinkPanel(guildId, ownerId, client.tokenStore, client, member);
        return await interaction.update(panel);
    }

    if (interaction.customId.startsWith('select_slot_')) {
        const slotToSelect = parseInt(interaction.customId.split('_')[2]);
        await client.tokenStore.setActiveSlot(guildId, ownerId, slotToSelect);
        const panel = await buildPremiumLinkPanel(guildId, ownerId, client.tokenStore, client, member);
        return await interaction.update(panel);
    }
}

export async function handleModal(interaction, client) {
    if (!interaction.customId.startsWith('link_modal_slot_')) return;
    const slot = parseInt(interaction.customId.split('_')[3]);
    const token = interaction.fields.getTextInputValue('token_input').trim();
    const prefix = getClientPrefix(client, interaction.guild.id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const prog = await getProgressiveSlots(interaction.member);
        const slotData = prog.slots.find(s => s.slot === slot);
        if (!slotData?.can) throw new Error(`Slot #${slot} is locked! ${slotData?.reason}`);
        const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: token } });
        if (!res.ok) throw new Error('Invalid token provided - Discord rejected request');
        const data = await res.json();
        await client.tokenStore.saveSlot({
            guildId: interaction.guild.id, ownerId: interaction.user.id, slot, token,
            linkedUserId: data.id, username: data.username, avatar: data.avatar, linkedAt: new Date()
        });
        await client.tokenStore.setActiveSlot(interaction.guild.id, interaction.user.id, slot);
        if (interaction.message) {
            const updatedPanel = await buildPremiumLinkPanel(interaction.guild.id, interaction.user.id, client.tokenStore, client, interaction.member);
            await interaction.message.edit(updatedPanel).catch(() => {});
        }
        const successContainer = new ContainerBuilder().setAccentColor(0x57F287);
        successContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ✅ Slot #${slot} Linked!\nLinked as **"${data.username}"**.\n\nYou can now use \`${prefix}quest\`, \`${prefix}questall\`, and \`${prefix}questlist\`.\nTo remove it, use \`${prefix}unlink${slot}\`.`
        ));
        await interaction.editReply({ components: [successContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    } catch (e) {
        const errContainer = new ContainerBuilder().setAccentColor(0xED4245);
        errContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ❌ Slot #${slot} Failed\n${e.message}`));
        await interaction.editReply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
}
