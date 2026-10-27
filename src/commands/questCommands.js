/**
 * questCommands.js - QuestAll, QuestList, TokenCheck, AutoQuest Runner Support, Live % Tracker & 'q' Shortcut
 * Location: src/commands/questCommands.js
 */

import {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    SectionBuilder, ThumbnailBuilder, MessageFlags, SlashCommandBuilder
} from 'discord.js';
import { QuestClient } from '../quest/questClient.js';
import { disableAutoquest } from '../quest/autoquestStore.js';
import { PREFIX } from '../utils/config.js';

// ── Helper: Get active token for user from 5-Slot Store ────────────────────
async function getActiveToken(guildId, userId, tokenStore) {
    if (!tokenStore) return null;
    const active = await tokenStore.getActiveSlot(guildId, userId);
    if (!active) return null;
    return active.token || await tokenStore.get(guildId, userId, active.slot);
}

// ── Helper: Safe Thumbnail Asset Extractor ────────────────────────────────
function getThumbUrl(cfg) {
    const appId = cfg?.application?.id;
    const assets = cfg?.assets;
    if (!appId || !assets) return null;

    const assetKey = assets.game_tile || assets.hero || assets.quest_bar || assets.card || Object.values(assets)[0];
    if (!assetKey) return null;

    return `https://cdn.discordapp.com/app-assets/${appId}/quest-assets/${assetKey}.png`;
}

// ── UI Cards ───────────────────────────────────────────────────────────────

function buildLinkPrompt(prefix) {
    const c = new ContainerBuilder().setAccentColor(0xFEE75C);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🔗 Token Required\nYou need to link your Discord token in a slot before using quest commands.\n\nUse \`${prefix}link\` to open your 5-slot account panel and link a token.`,
        ),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildNoQuestsCard() {
    const c = new ContainerBuilder().setAccentColor(0x4F545C);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🔍 No Quests Available\nThere are no active, uncompleted quests on your active slot account right now.`,
        ),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildExpiredTokenCard(prefix) {
    const c = new ContainerBuilder().setAccentColor(0xED4245);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ❌ Token Expired\nYour saved token on the active slot was rejected by Discord — it has likely expired.\n\n**Your active slot token has been removed.** Re-link using \`${prefix}link\`.`,
        ),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildErrorCard(err, prefix) {
    const msg = err?.message ?? String(err);
    const is401 = msg.includes('401');
    const c = new ContainerBuilder().setAccentColor(0xED4245);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            is401
                ? `# ❌ Invalid or Expired Token\nRe-link your token using \`${prefix}link\`.`
                : `# ❌ Error\n${msg.slice(0, 800)}`,
        ),
    );
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildQuestInfoCard(quest, phase, claimed = 0, failReason = '', percent = 0) {
    const cfg  = quest.config;
    const msgs = cfg.messages;
    const thumbUrl = getThumbUrl(cfg);

    const TASK_META = {
        PLAY_ON_DESKTOP:       { icon: '🖥️', label: 'Play on Desktop' },
        WATCH_VIDEO:           { icon: '🎬', label: 'Watch Video' },
        STREAM_ON_DESKTOP:     { icon: '📺', label: 'Stream on Desktop' },
        PLAY_ACTIVITY:         { icon: '🎮', label: 'Play Activity' },
        WATCH_VIDEO_ON_MOBILE: { icon: '📱', label: 'Watch Video on Mobile' },
    };

    const taskLines = Object.entries((cfg.task_config ?? cfg.task_config_v2)?.tasks ?? {}).map(([type, task]) => {
        const meta = TASK_META[type] ?? { icon: '⚙️', label: type };
        let dur = '';
        if (type === 'PLAY_ON_DESKTOP' || type === 'STREAM_ON_DESKTOP') {
            dur = `  •  **${Math.ceil(task.target / 60)} min**`;
        } else if (type === 'WATCH_VIDEO' || type === 'WATCH_VIDEO_ON_MOBILE') {
            const s = task.target;
            dur = s >= 60 ? `  •  **${Math.ceil(s / 60)} min**` : `  •  **${s}s**`;
        }
        return `${meta.icon}${meta.label}${dur}${phase === 'done' ? '  ✅' : ''}`;
    });

    const rewardLines = cfg.rewards_config.rewards.map((r) => {
        let line = `**${r.messages.name}**`;
        if (r.orb_quantity) line += `  ✦ *(${r.orb_quantity} Orbs)*`;
        else if (r.quantity) line += `  *(${r.quantity}d Nitro)*`;
        return line;
    });

    const expiresEpoch = Math.floor(new Date(cfg.expires_at).getTime() / 1000);
    const daysLeft = Math.max(0, Math.ceil((new Date(cfg.expires_at).getTime() - Date.now()) / 86400000));

    // Dynamic Live Progress Bar & % Renderer (10 Blocks)
    const currentPercent = Math.min(100, Math.max(0, Math.floor(percent)));
    const filledBlocks = Math.floor(currentPercent / 10);
    const emptyBlocks = 10 - filledBlocks;
    const progressBar = '`' + '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks) + '`' + `  **${currentPercent}%**`;

    const PHASE = {
        starting: { color: 0x5865F2, title: '⚙️  Solving Quest...',  bar: progressBar + '  —  *Working on it...*' },
        done:     { color: 0x57F287, title: '✅  Quest Complete!',    bar: '`██████████`  **100%**' },
        failed:   { color: 0xED4245, title: '❌  Quest Failed',       bar: '' },
    };

    const p = PHASE[phase];
    const progressText = phase === 'failed' && failReason
        ? `\`░░░░░░░░░░\`  **0%**\n\`\`\`\n${failReason.slice(0, 300)}\n\`\`\``
        : p.bar;

    const footerNote = phase === 'done' && claimed > 0
        ? `-# 🎁 ${claimed} reward(s) claimed`
        : phase === 'starting'
        ? `-# Quest Bot  •  Please wait...`
        : phase === 'failed'
        ? `-# Requires manual completion in the Discord app`
        : '';

    const c = new ContainerBuilder().setAccentColor(p.color);
    const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ${p.title}\n### ${msgs.quest_name}\n*${msgs.game_title}*  •  ${msgs.game_publisher}`,
        )
    );

    if (thumbUrl) {
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbUrl));
    }

    c.addSectionComponents(section);
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `📋 **Task**\n${taskLines.join('\n') || '*Unknown task*'}\n\n` +
            `📅 **Expires**  <t:${expiresEpoch}:R>  *(${daysLeft}d left)*\n\n` +
            `📊 **Progress**\n${progressText}\n\n` +
            `🎁 **Reward**\n${rewardLines.join('\n') || '*No rewards listed*'}`,
        ),
    );

    if (footerNote) {
        c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerNote));
    }

    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

// ── Quest Runners Logic ────────────────────────────────────────────────    

async function runQuestAll(guildId, userId, tokenStore, send, prefix) {
    const token = await getActiveToken(guildId, userId, tokenStore);
    if (!token) { await send(buildLinkPrompt(prefix)); return false; }

    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const valid = manager.filterQuestsValid();
        if (valid.length === 0) { await send(buildNoQuestsCard()); return false; }

        const progressMsgs = await Promise.all(valid.map((q) => send(buildQuestInfoCard(q, 'starting', 0, '', 0))));
        const questLogs = valid.map(() => []);

        const questResults = await Promise.allSettled(
            valid.map((quest, i) => {
                const progressMsg = progressMsgs[i];
                let lastPct = -1;

                // Live Progress % Callback function
                const onProgress = async (done, total) => {
                    const pct = Math.min(100, Math.floor((done / total) * 100));
                    // Rate-limit safety: edit message if % increases by at least 3% or reaches 100%
                    if (pct >= lastPct + 3 || pct === 100) {
                        lastPct = pct;
                        await progressMsg.edit(buildQuestInfoCard(quest, 'starting', 0, '', pct)).catch(() => {});
                    }
                };

                const log = (m) => { console.log(m); questLogs[i].push(m); };
                return manager.doingQuest(quest, log, onProgress);
            }),
        );

        const completed = valid.filter((_, i) => questResults[i].status === 'fulfilled' && questResults[i].value === true);
        const skipped   = valid.filter((_, i) => questResults[i].status === 'rejected' || (questResults[i].status === 'fulfilled' && questResults[i].value === false));

        await Promise.allSettled(skipped.map((q) => {
            const idx = valid.indexOf(q);
            const failLogs = questLogs[idx].filter(l => l.startsWith('[FAIL]'));
            const reason = questResults[idx].status === 'rejected'
                ? questResults[idx].reason?.message ?? 'Unknown error'
                : failLogs.slice(-2).join('\n') || questLogs[idx].slice(-3).join('\n') || 'Could not be completed automatically.';
            return progressMsgs[idx].edit(buildQuestInfoCard(q, 'failed', 0, reason));
        }));

        if (completed.length === 0) {
            const c = new ContainerBuilder().setAccentColor(0xFEE75C);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ⚠️ No Quests Auto-Completed\nAll quests require manual completion via the Discord desktop or mobile app.`));
            await send({ components: [c], flags: MessageFlags.IsComponentsV2 });
            return false;
        }

        let totalClaimed = 0;
        for (const q of completed) {
            const cCount = await manager.claimRewards(console.log, q.id).catch(() => 0);
            totalClaimed += cCount;
        }
        const claimed = totalClaimed;
        const claimedPer = completed.length > 0 ? Math.floor(claimed / completed.length) : 0;

        await Promise.allSettled(completed.map((q, i) => {
            const idx = valid.indexOf(q);
            return progressMsgs[idx].edit(buildQuestInfoCard(q, 'done', i === 0 ? claimed : claimedPer, '', 100));
        }));
        return true;

    } catch (err) {
        const msg = err?.message ?? String(err);
        if (msg.includes('401')) {
            const active = await tokenStore.getActiveSlot(guildId, userId);
            if (active) await tokenStore.removeSlot(guildId, userId, active.slot);
            disableAutoquest(userId);
            await send(buildExpiredTokenCard(prefix)).catch(() => {});
        } else {
            await send(buildErrorCard(err, prefix)).catch(() => {});
        }
        return false;
    }
}

async function runQuestList(guildId, userId, tokenStore, send, prefix) {
    const token = await getActiveToken(guildId, userId, tokenStore);
    if (!token) { await send(buildLinkPrompt(prefix)); return; }

    const qc = new QuestClient(token);
    try {
        const manager = await qc.fetchQuests();
        const all = manager.list();
        if (all.length === 0) { await send(buildNoQuestsCard()); return; }

        const TASK_META = {
            PLAY_ON_DESKTOP:       { icon: '🖥️', label: 'Play on Desktop' },
            WATCH_VIDEO:           { icon: '🎬', label: 'Watch Video' },
            STREAM_ON_DESKTOP:     { icon: '📺', label: 'Stream on Desktop' },
            PLAY_ACTIVITY:         { icon: '🎮', label: 'Play Activity' },
            WATCH_VIDEO_ON_MOBILE: { icon: '📱', label: 'Watch Video on Mobile' },
        };

        for (const q of all.slice(0, 10)) {
            const cfg = q.config;
            const msgs = cfg.messages;
            const thumbUrl = getThumbUrl(cfg);
            const expiresEpoch = Math.floor(new Date(cfg.expires_at).getTime() / 1000);
            const daysLeft = Math.max(0, Math.ceil((new Date(cfg.expires_at).getTime() - Date.now()) / 86400000));

            const st = q.isCompleted() ? { color: 0x57F287, icon: '✅', label: 'Completed' }
                : q.isExpired()        ? { color: 0xED4245, icon: '🔴', label: 'Expired' }
                : q.isEnrolledQuest()  ? { color: 0xFEE75C, icon: '⏳', label: 'In Progress' }
                :                        { color: 0x5865F2, icon: '🔵', label: 'Available' };

            const taskLines = Object.entries((cfg.task_config ?? cfg.task_config_v2)?.tasks ?? {}).map(([type, task]) => {
                const meta = TASK_META[type] ?? { icon: '⚙️', label: type };
                let dur = '';
                if (type === 'PLAY_ON_DESKTOP' || type === 'STREAM_ON_DESKTOP') dur = `  •  **${Math.ceil(task.target / 60)} min**`;
                else if (type === 'WATCH_VIDEO' || type === 'WATCH_VIDEO_ON_MOBILE') {
                    const s = task.target;
                    dur = s >= 60 ? `  •  **${Math.ceil(s / 60)} min**` : `  •  **${s}s**`;
                }
                return `${meta.icon} ${meta.label}${dur}`;
            });

            const rewardLines = cfg.rewards_config.rewards.map((r) => {
                let line = `**${r.messages.name}**`;
                if (r.orb_quantity) line += `  ✦ *(${r.orb_quantity} Orbs)*`;
                else if (r.quantity) line += `  *(${r.quantity}d Nitro)*`;
                return line;
            });

            const c = new ContainerBuilder().setAccentColor(st.color);
            const section = new SectionBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# ${st.icon}  ${msgs.quest_name}\n*${msgs.game_title}*  •  ${msgs.game_publisher}`,
                )
            );

            if (thumbUrl) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbUrl));

            c.addSectionComponents(section);
            c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            c.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `📊 **Status:** ${st.label}   📅 **Expires:** <t:${expiresEpoch}:R> *(${daysLeft}d)*\n\n` +
                    `📋 **Task**\n${taskLines.join('\n') || '*Unknown*'}\n\n` +
                    `🎁 **Reward**\n${rewardLines.join('\n') || '*No rewards listed*'}`,
                ),
            );
            await send({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        if (all.length > 10) {
            const c = new ContainerBuilder().setAccentColor(0x4F545C);
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# …and **${all.length - 10}** more quest(s) not shown.`));
            await send({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

    } catch (err) {
        await send(buildErrorCard(err, prefix)).catch(() => {});
    }
}

async function runTokenCheck(guildId, userId, tokenStore, replyFn, prefix) {
    const token = await getActiveToken(guildId, userId, tokenStore);
    if (!token) {
        const c = new ContainerBuilder().setAccentColor(0xFEE75C);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# No Active Slot Token\nYou don't have an active token set in your slots. Use \`${prefix}link\` to configure your slots.`));
        await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
        return;
    }

    let valid = false, accountName = '';
    try {
        const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: token } });
        valid = res.ok;
        if (res.ok) {
            const data = await res.json();
            accountName = data.global_name || data.username || '';
        }
    } catch { valid = false; }

    const c = new ContainerBuilder().setAccentColor(valid ? 0x57F287 : 0xED4245);
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            valid
                ? `# ✅ Token is Valid\nActive slot linked as **"${accountName}"**.\n\nYour active token is working correctly.`
                : `# ❌ Token Invalid or Expired\nYour active slot token was rejected by Discord.\nUse \`${prefix}link\` to manage and update your slots.`,
        ),
    );
    await replyFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
    if (!valid) {
        const active = await tokenStore.getActiveSlot(guildId, userId);
        if (active) await tokenStore.removeSlot(guildId, userId, active.slot);
    }
}

// ── Exports ────────────────────────────────────────────────────────────────

export const questAllCmd = {
    data: new SlashCommandBuilder().setName('questall').setDescription('Complete all quests at once'),
    prefix: 'questall',
    async execute(interaction, client) {
        await interaction.deferReply();
        await runQuestAll(interaction.guild.id, interaction.user.id, client.tokenStore, (opts) => interaction.followUp(opts), PREFIX);
    },
    async prefixExecute(message, _args, client) {
        await runQuestAll(message.guild.id, message.author.id, client.tokenStore, (opts) => message.channel.send(opts), PREFIX);
    },
};

export const qCmd = {
    data: new SlashCommandBuilder().setName('q').setDescription('Complete all quests at once (Shortcut)'),
    prefix: 'q',
    async execute(interaction, client) {
        await interaction.deferReply();
        await runQuestAll(interaction.guild.id, interaction.user.id, client.tokenStore, (opts) => interaction.followUp(opts), PREFIX);
    },
    async prefixExecute(message, _args, client) {
        await runQuestAll(message.guild.id, message.author.id, client.tokenStore, (opts) => message.channel.send(opts), PREFIX);
    },
};

export const questListCmd = {
    data: new SlashCommandBuilder().setName('questlist').setDescription('List all Discord quests and their status'),
    prefix: 'questlist',
    async execute(interaction, client) {
        await interaction.deferReply();
        await runQuestList(interaction.guild.id, interaction.user.id, client.tokenStore, (opts) => interaction.followUp(opts), PREFIX);
    },
    async prefixExecute(message, _args, client) {
        await runQuestList(message.guild.id, message.author.id, client.tokenStore, (opts) => message.channel.send(opts), PREFIX);
    },
};

export const tokenCheckCmd = {
    data: new SlashCommandBuilder().setName('tokencheck').setDescription('Check whether your saved Discord token is still valid'),
    prefix: 'tokencheck',
    async execute(interaction, client) {
        await interaction.deferReply({ flags: 64 });
        await runTokenCheck(interaction.guild.id, interaction.user.id, client.tokenStore, (opts) => interaction.editReply(opts), PREFIX);
    },
    async prefixExecute(message, _args, client) {
        await runTokenCheck(message.guild.id, message.author.id, client.tokenStore, (opts) => message.reply(opts), PREFIX);
    },
};

export async function runAutoquestForUser(userId, quest, tokenStore, discordClient, guildId) {
    const active = await tokenStore.getActiveSlot(guildId, userId);
    if (!active) { disableAutoquest(userId); return; }
    const token = active.token || await tokenStore.get(guildId, userId, active.slot);
    if (!token) { disableAutoquest(userId); return; }

    const { QuestClient: QC } = await import('../quest/questClient.js');
    const { Quest: Q } = await import('../quest/quest.js');
    const qc = new QC(token);
    const logs = [];
    const log = (m) => { console.log(`[AutoQuest:${userId}]`, m); logs.push(m); };

    try {
        const manager = await qc.fetchQuests();
        let live = manager.get(quest.id);
        if (!live) {
            live = Q.create({ id: quest.id, config: quest.config, user_status: null, targeted_content: quest.targetedContent, preview: quest.preview });
        }
        if (live.isCompleted() || live.isExpired()) return;

        await manager.doingQuest(live, log);

        let claimManager = manager;
        try { claimManager = await qc.fetchQuests(); } catch { if (!manager.hasQuest(live.id)) manager.upsert(live); }

        const claimed = await claimManager.claimRewards(log, live.id).catch(() => 0);

        try {
            const user = await discordClient.users.fetch(userId);
            const dm = await user.createDM();
            const c = new ContainerBuilder().setAccentColor(0x57F287);
            c.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🤖 Auto-Quest Complete!\n**${live.config.messages.quest_name}** has been completed automatically on your active slot.\n${claimed > 0 ? `🎁 **${claimed}** reward(s) claimed.\n` : ''}\nUse \`${PREFIX}autoquest\` to disable.`,
                ),
            );
            await dm.send({ components: [c], flags: MessageFlags.IsComponentsV2 });
        } catch {}

    } catch (err) {
        const msg = err?.message ?? String(err);
        console.error(`[AutoQuest:${userId}] Error:`, msg);
        if (msg.includes('401')) {
            await tokenStore.removeSlot(guildId, userId, active.slot);
            disableAutoquest(userId);
            try {
                const user = await discordClient.users.fetch(userId);
                const dm = await user.createDM();
                const c = new ContainerBuilder().setAccentColor(0xED4245);
                c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🤖 Auto-Quest Paused\nYour active slot token expired. Run \`${PREFIX}link\` to re-configure slots.`));
                await dm.send({ components: [c], flags: MessageFlags.IsComponentsV2 });
            } catch {}
        }
    }
}
