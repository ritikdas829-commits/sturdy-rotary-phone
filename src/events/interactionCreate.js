/**
 * interactionCreate.js — Complete Interaction Handler with Single-DM Protection & Specific Quest Link
 * Location: src/events/interactionCreate.js
 */

import { getEmoji } from '../handlers/emoji.js';
import { handleGuideButtons } from '../commands/guide.js';
import { handleButton as handlePremiumButton, handleModal as handlePremiumModal } from '../commands/premiumLink.js';
import { buildQuestSolverPanel } from '../quest/questUI.js';
import { QuestClient } from '../quest/questClient.js';
import { QuestManager } from '../quest/questManager.js';

// Map to track active running intervals and abort flags across users
const activeRunners = new Map();

export default {
    name: 'interactionCreate',
    once: false,
    async execute(interaction, client) {
        try {
            const guildId = interaction.guildId;
            const userId = interaction.user?.id;

            // 1. Guide Buttons Handler
            if (interaction.isButton() && ['btn_pc', 'btn_android', 'btn_ios'].includes(interaction.customId)) {
                await handleGuideButtons(interaction);
                return;
            }

            // 2. Premium Slot Buttons Handler
            if (interaction.isButton() && (
                interaction.customId.startsWith('link_slot_') ||
                interaction.customId.startsWith('unlink_slot_') ||
                interaction.customId.startsWith('select_slot_')
            )) {
                await handlePremiumButton(interaction, client);
                return;
            }

            // 3. Link Prompt Button
            if (interaction.isButton() && interaction.customId === 'link_prompt') {
                await interaction.reply({ content: '🔗 Please use the link command or manage slots via premium panel.', flags: 64 }).catch(() => {});
                return;
            }

            // 4. Modals Handler
            if (interaction.isModalSubmit()) {
                if (interaction.customId.startsWith('link_modal_slot_')) {
                    await handlePremiumModal(interaction, client);
                    return;
                }
                if (interaction.customId === 'link_token_modal') {
                    await interaction.reply({ content: '✅ Token modal received.', flags: 64 }).catch(() => {});
                    return;
                }
            }

            // 5. Quest Select Menu Handler
            if (interaction.isStringSelectMenu() && (interaction.customId === 'quest_select' || interaction.customId.startsWith('quest_select_'))) {
                await interaction.deferUpdate();
                const selectedQuestId = interaction.values[0];
                const panel = await buildQuestSolverPanel(client, guildId, userId, selectedQuestId);
                await interaction.editReply(panel);
                return;
            }

            // 6. Refresh Button Handler (Preserves selected quest context)
            if (interaction.isButton() && interaction.customId === 'quest_refresh') {
                await interaction.deferUpdate();

                let currentQuestId = null;
                try {
                    const row = interaction.message.components.find(r => r.components?.some(c => c.customId === 'quest_select'));
                    const menu = row?.components?.find(c => c.customId === 'quest_select');
                    if (menu?.options) {
                        const defaultOpt = menu.options.find(o => o.default);
                        if (defaultOpt) currentQuestId = defaultOpt.value;
                    }
                } catch {}

                const timeString = new Date().toLocaleTimeString();
                const loadingLogs = `🔄 Refreshing quests...\n[${timeString}] Fetching latest progress from Discord...`;

                const panel = await buildQuestSolverPanel(client, guildId, userId, currentQuestId, loadingLogs);
                await interaction.editReply(panel);

                setTimeout(async () => {
                    const freshPanel = await buildQuestSolverPanel(client, guildId, userId, currentQuestId);
                    await interaction.editReply(freshPanel).catch(() => {});
                }, 1500);

                return;
            }

            // 7. Start Button Handler — Anti-Spam DM Protection + Unique Quest Link
            if (interaction.isButton() && interaction.customId.startsWith('quest_start_')) {
                await interaction.deferUpdate();
                const questId = interaction.customId.replace('quest_start_', '');
                const runnerKey = `${guildId}_${userId}`;

                if (activeRunners.has(runnerKey)) {
                    const existing = activeRunners.get(runnerKey);
                    existing.isRunning = false;
                    clearInterval(existing.interval);
                    activeRunners.delete(runnerKey);
                }

                const tokenStore = client.tokenStore;
                const active = await tokenStore.getActiveSlot(guildId, userId);
                const token = active ? (active.token || await tokenStore.get(guildId, userId, active.slot)) : null;

                if (!active || !token) {
                    await interaction.followUp({ content: '❌ No active token slot found! Use `;link` first.', flags: 64 });
                    return;
                }

                const cleanToken = typeof token === 'string' ? token.trim().replace(/['"]+/g, '') : token;
                const qc = new QuestClient(cleanToken);

                let manager;
                try {
                    manager = await qc.fetchQuests();
                } catch (err) {
                    const errorPanel = await buildQuestSolverPanel(client, guildId, userId, questId, `❌ Fetch Error: ${err.message}`);
                    await interaction.editReply(errorPanel);
                    return;
                }

                const quest = manager.get(questId);
                if (!quest) {
                    const missingPanel = await buildQuestSolverPanel(client, guildId, userId, questId, `❌ Quest ID ${questId} not found or expired.`);
                    await interaction.editReply(missingPanel);
                    return;
                }

                const questName = quest.config?.messages?.quest_name || quest.config?.application?.name || 'Discord Quest';

                if (quest.isCompleted()) {
                    const claimLog = `🎁 Claiming reward for quest: ${questName}...`;
                    const claimPanel = await buildQuestSolverPanel(client, guildId, userId, questId, claimLog);
                    await interaction.editReply(claimPanel);

                    const claimedCount = await manager.claimRewards(async (msg) => {
                        console.log(`[Claim Log] ${msg}`);
                    });

                    const resultLog = claimedCount > 0
                        ? `🎉 Quest completed & reward claimed successfully!`
                        : `⚠️ Quest completed, reward already claimed or pending verification.`;

                    const finalPanel = await buildQuestSolverPanel(client, guildId, userId, questId, resultLog);
                    await interaction.editReply(finalPanel);
                    return;
                }

                // Add notified flag to track DM status and prevent spam
                const runnerContext = { isRunning: true, interval: null, notified: false };
                activeRunners.set(runnerKey, runnerContext);

                manager.doingQuest(quest, async (msg) => {
                    console.log(`[Quest Runner Log] ${msg}`);
                }, async (current, target) => {}).then(async (success) => {
                    runnerContext.isRunning = false;
                    if (activeRunners.get(runnerKey) === runnerContext) {
                        clearInterval(runnerContext.interval);
                        activeRunners.delete(runnerKey);
                    }

                    const doneLog = success
                        ? `🎉 Quest completed successfully!`
                        : `⚠️ Quest runner finished with warnings.`;

                    const completePanel = await buildQuestSolverPanel(client, guildId, userId, questId, doneLog);
                    await interaction.editReply(completePanel).catch(() => {});

                    // Send DM only if successfully completed AND not previously notified
                    if (success && !runnerContext.notified) {
                        runnerContext.notified = true;
                        const specificQuestLink = `https://discord.com/quests/${questId}`;
                        try {
                            const targetUser = await client.users.fetch(userId);
                            await targetUser.send(`🎉 **Quest Completed Successfully!**\n\n📌 **Quest Name:** ${questName}\n🆔 **Quest ID:** \`${questId}\`\n✨ **Status:** 100% Completed\n🔗 **View Quest:** ${specificQuestLink}`);
                        } catch {
                            await interaction.followUp({
                                content: `<@${userId}> 🎉 **Quest Completed!**\n📌 **Quest Name:** ${questName}\n🔗 ${specificQuestLink}`,
                                allowedMentions: { users: [userId] }
                            }).catch(() => {});
                        }
                    }
                }).catch((err) => {
                    runnerContext.isRunning = false;
                    console.error('Quest execution error:', err);
                });

                runnerContext.interval = setInterval(async () => {
                    if (!runnerContext.isRunning) {
                        clearInterval(runnerContext.interval);
                        activeRunners.delete(runnerKey);
                        return;
                    }

                    try {
                        const nowTime = new Date().toLocaleTimeString();
                        const runnerLogs = `Quest selected: ${questName}\n[${nowTime}] Fast mode active\nProgress updating...`;
                        const autoPanel = await buildQuestSolverPanel(client, guildId, userId, questId, runnerLogs);
                        await interaction.editReply(autoPanel).catch(() => {});
                    } catch (e) {
                        console.error('Auto-refresh UI update error:', e.message);
                    }
                }, 5000);

                setTimeout(() => {
                    if (activeRunners.get(runnerKey) === runnerContext) {
                        runnerContext.isRunning = false;
                        clearInterval(runnerContext.interval);
                        activeRunners.delete(runnerKey);
                    }
                }, 10 * 60 * 1000);

                return;
            }

            // 8. Stop Button Handler
            if (interaction.isButton() && interaction.customId.startsWith('quest_stop_')) {
                await interaction.deferUpdate();
                const questId = interaction.customId.replace('quest_stop_', '');
                const runnerKey = `${guildId}_${userId}`;

                if (activeRunners.has(runnerKey)) {
                    const existing = activeRunners.get(runnerKey);
                    existing.isRunning = false;
                    clearInterval(existing.interval);
                    activeRunners.delete(runnerKey);
                }

                const stopLog = `⏹️ Stopped\n[${new Date().toLocaleTimeString()}] Quest runner stopped by user.`;
                const panel = await buildQuestSolverPanel(client, guildId, userId, questId, stopLog);
                await interaction.editReply(panel);
                return;
            }

            // 9. Slash Commands Handler
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;
                await command.execute(interaction, client);
            }
        } catch (err) {
            console.error('❌ Interaction Error:', err);
            const msg = { content: `${getEmoji('error')} Something went wrong.`, flags: 64 };
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                await interaction.reply(msg).catch(() => {});
            } else if (interaction.isRepliable() && interaction.deferred) {
                await interaction.followUp(msg).catch(() => {});
            }
        }
    },
};
