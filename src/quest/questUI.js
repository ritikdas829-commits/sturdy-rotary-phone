/**
 * questUI.js — High-Performance MongoDB Emoji Integration & Enhanced Error Reporting
 * Location: src/quest/questUI.js
 */

import {
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} from 'discord.js';
import { QuestClient } from './questClient.js';
import { getEmojis } from './emoji.js';

const ACCENT = 0x2B2D31;
const EXCLUDED_QUEST_ID = '1412491570820812933';

function parseEmoji(s) {
    if (!s) return { name: '💎' };
    const m = s.match(/<a?:(\w+):(\d+)>/);
    if (m) return { name: m[1], id: m[2], animated: s.startsWith('<a:') };
    return { name: s };
}

function getTasks(c) { return c?.task_config?.tasks ?? c?.task_config_v2?.tasks ?? {}; }

function getTaskProgress(type, cfg, status) {
    if (!status) return 0;
    const target = Number(cfg?.target ?? 1);
    if (!Number.isFinite(target) || target <= 0) return 0;
    const p = status.progress ?? {}, d = status.details ?? {};
    const en = cfg?.event_name ?? cfg?.type ?? type;
    const cand = [d[type]?.progress, d[type]?.value, d[en]?.progress, p[type]?.value, p[type]?.progress, p[en]?.value];
    let cur = 0;
    for (const c of cand) { 
        if (c == null) continue; 
        const v = typeof c === 'object' ? (c.value ?? c.progress) : c; 
        const n = Number(v); 
        if (Number.isFinite(n)) { cur = Math.max(0, n); break; } 
    }
    if (status.stream_progress_seconds != null) cur = Math.max(cur, Number(status.stream_progress_seconds) || 0);
    if (status.video_progress_seconds != null) cur = Math.max(cur, Number(status.video_progress_seconds) || 0);
    return Math.min(100, Math.floor((cur / target) * 100));
}

function getQuestImages(quest) {
    const data = quest?.toJSON?.() ?? {};
    const config = quest?.config ?? data.config ?? {};
    const assets = config.assets ?? {};
    const app = quest?.application ?? config.application ?? {};
    const appId = app.id || config.application_id || config.application?.id;
    
    let banner = null;
    const possibleUrls = [
        data.bannerURL,
        data.bannerUrl,
        config.banner_url,
        config.image_url,
        assets.hero,
        assets.game_tile,
        assets.quest_tile,
        assets.banner
    ];

    for (const u of possibleUrls) {
        if (typeof u === 'string' && u.trim().startsWith('https://') && !/\.mp4/i.test(u)) {
            banner = u.trim();
            break;
        }
    }

    if (!banner && appId) {
        for (const k of ['hero', 'game_tile', 'quest_tile', 'banner']) {
            const v = assets[k];
            if (!v) continue;
            let s = String(v).trim();
            if (s.startsWith('https://') && !/\.mp4/i.test(s)) {
                banner = s;
                break;
            }
            if (s) {
                banner = `https://cdn.discordapp.com/app-assets/${appId}/${s}`;
                break;
            }
        }
    }

    let icon = null;
    const rawIcon = app.icon || config.icon || app.icon_hash || assets.icon;
    if (typeof rawIcon === 'string' && rawIcon.trim() !== '') {
        const t = rawIcon.trim();
        if (t.startsWith('https://')) icon = t;
        else if (appId) icon = `https://cdn.discordapp.com/app-icons/${appId}/${t}.png?size=512`;
    }

    if (!banner && icon) banner = icon;
    return { banner, icon };
}

function formatTimestamp(v) { if (!v) return 'N/A'; const d = new Date(v); if (isNaN(d.getTime())) return 'N/A'; return `<t:${Math.floor(d.getTime() / 1000)}:d>`; }
function shorten(v, max = 100) { return String(v ?? '').slice(0, max); }
function progressBar(p) { const f = Math.round(p / 10); return '#'.repeat(f) + '-'.repeat(10 - f); }
function text(c) { return new TextDisplayBuilder().setContent(c); }

export async function buildQuestSolverPanel(client, guildId, userId, selectedQuestId, customLogs) {
    // 🎨 Load dynamic custom emojis from MongoDB
    const EMOJI = await getEmojis(guildId);

    const tokenStore = client.tokenStore;
    if (!tokenStore) {
        const c = new ContainerBuilder().setAccentColor(0xED4245);
        c.addTextDisplayComponents(text(
            `### ❌ Token System Unreachable\n` +
            `The internal Token Store system is currently unavailable or uninitialized. Please contact an administrator.`
        ));
        return { components: [c], flags: MessageFlags.IsComponentsV2 };
    }

    let active, token;
    try {
        active = await tokenStore.getActiveSlot(guildId, userId);
        token = active ? (active.token || await tokenStore.get(guildId, userId, active.slot)) : null;
    } catch (err) {
        const c = new ContainerBuilder().setAccentColor(0xED4245);
        c.addTextDisplayComponents(text(
            `### ⚠️ Database Read Failure\n` +
            `Unable to retrieve user token configuration from the database.\n` +
            `**Technical Reason:** \`${shorten(err.message, 150)}\``
        ));
        return { components: [c], flags: MessageFlags.IsComponentsV2 };
    }

    if (!active || !token) {
        const c = new ContainerBuilder().setAccentColor(0xED4245);
        c.addTextDisplayComponents(text(
            `### 🔑 No Active Discord Account Linked\n` +
            `You do not have an active account token selected in this server.\n\n` +
            `**How to resolve:**\n` +
            `• Link a valid user token to your active slot using \`?link \` or slot configuration.\n` +
            `• Check if your active slot is toggled on.`
        ));
        return { components: [c], flags: MessageFlags.IsComponentsV2 };
    }

    let rawQuests;
    try {
        const qc = new QuestClient(token.trim().replace(/^['"]|['"]$/g, ''));
        const manager = await qc.fetchQuests();
        rawQuests = manager.list() ?? [];
    } catch (e) {
        const c = new ContainerBuilder().setAccentColor(0xED4245);
        c.addTextDisplayComponents(text(
            `### ⚠️ Discord API Authentication Error\n` +
            `Failed to fetch quest details using the provided account token.\n\n` +
            `**Possible Causes:**\n` +
            `• The account token has expired, been reset, or is invalid.\n` +
            `• Discord gateway rate limits or temporary service disruption.\n\n` +
            `**Technical Details:** \`${shorten(String(e.message ?? e), 200)}\``
        ));
        return { components: [c], flags: MessageFlags.IsComponentsV2 };
    }

    const activeQuests = rawQuests.filter(q => {
        try { return q.id !== EXCLUDED_QUEST_ID && !q.isExpired?.() && !q.isCompleted?.(); } catch { return true; }
    });

    const allQuests = activeQuests.map(quest => {
        const config = quest.config ?? {}, messages = config.messages ?? {}, tasks = getTasks(config), status = quest.userStatus ?? {}, images = getQuestImages(quest);
        const platformProgress = {};
        for (const t of Object.keys(tasks)) platformProgress[t] = getTaskProgress(t, tasks[t], status);
        const seen = new Set(), uniq = [];
        for (const k of Object.keys(platformProgress)) {
            const base = k.replace(/_\d+$/, '');
            if (!seen.has(base)) { seen.add(base); uniq.push(platformProgress[k]); }
        }
        const total = uniq.length ? Math.max(...uniq) : 0;
        return { id: quest.id, game: messages.game_title || config.application?.name || 'Unknown Game', publisher: messages.game_publisher || 'Unknown Publisher', questName: messages.quest_name || 'Discord Quest', enrolledAt: formatTimestamp(status.enrolled_at), expiresAt: formatTimestamp(config.expires_at), tasks, platformProgress, images, progress: { total } };
    });

    if (!allQuests.length) {
        const c = new ContainerBuilder().setAccentColor(ACCENT);
        c.addTextDisplayComponents(text(
            `# ${EMOJI.list} Quest Solver\n\n` +
            `### ℹ️ No Active Quests Available\n` +
            `There are currently no active or uncompleted quests linked to your Discord account.`
        ));
        return { components: [c], flags: MessageFlags.IsComponentsV2 };
    }

    const selected = allQuests.find(q => String(q.id) === String(selectedQuestId)) ?? allQuests[0];
    const container = new ContainerBuilder().setAccentColor(ACCENT);
    container.addTextDisplayComponents(text(`# ${EMOJI.s_admin} ${selected.game}`));

    const desktopPct = selected.platformProgress['PLAY_ON_DESKTOP'] ?? selected.platformProgress['WATCH_VIDEO'] ?? selected.platformProgress['WATCH_VIDEO_ON_DESKTOP'] ?? selected.progress.total;
    const mobilePct = selected.platformProgress['WATCH_VIDEO_ON_MOBILE'] ?? selected.platformProgress['PLAY_ON_MOBILE'] ?? 0;

    let info = `### ${EMOJI.orbs} Quest Overview\n`;
    info += `${EMOJI.gift} **Reward:** 200 Orbs ${EMOJI.orbs}\n`;
    info += `${EMOJI.online} **Game:** ${selected.game}\n`;
    info += `${EMOJI.list} **Publisher:** ${selected.publisher}\n`;
    info += `${EMOJI.online} **Enrolled At:** ${selected.enrolledAt}\n`;
    info += `${EMOJI.arrow} **Expires At:** ${selected.expiresAt}\n\n`;
    info += `### ${EMOJI.loading} Live Progress\n`;
    const progIcon = selected.progress.total >= 100 ? '✅' : EMOJI.dot;
    info += `${progIcon} **Progress:** \`${selected.progress.total}%\`\n`;
    info += `-# ${EMOJI.online} **Web/Desktop**: ${desktopPct}%\n`;
    info += `-# ${EMOJI.online} **Mobile**: ${mobilePct}%\n`;
    container.addTextDisplayComponents(text(info));

    const seenT = new Set(), taskLines = [];
    for (const type of Object.keys(selected.tasks)) {
        const base = type.replace(/_\d+$/, '');
        if (seenT.has(base)) continue;
        seenT.add(base);
        const t = selected.tasks[type];
        if (type.includes('PLAY_ON_DESKTOP')) taskLines.push(`${EMOJI.dot} Play On Desktop for ${Math.ceil((t.target || 900) / 60)} minutes`);
        else if (type.includes('WATCH_VIDEO_ON_MOBILE')) taskLines.push(`${EMOJI.dot} Watch Video On Mobile for ${Math.ceil((t.target || 0) / 60)} minutes`);
        else if (type.includes('WATCH_VIDEO')) taskLines.push(`${EMOJI.dot} Watch Video On Desktop for ${Math.ceil((t.target || 0) / 60)} minutes`);
        else taskLines.push(`${EMOJI.dot} ${type.replace(/_/g, ' ')}`);
    }
    container.addTextDisplayComponents(text(`### ${EMOJI.list} Tasks Required:\n${taskLines.join('\n')}`));

    // BANNER GALLERY
    const galleryItems = [];
    const img = selected.images?.banner || selected.images?.icon;
    if (img && typeof img === 'string' && img.startsWith('https://') && !img.includes('avatars/0.png')) {
        try {
            galleryItems.push(
                new MediaGalleryItemBuilder()
                    .setURL(img)
                    .setDescription(shorten(selected.game, 100))
            );
        } catch {}
    }
    if (galleryItems.length > 0) {
        try { 
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(galleryItems)
            ); 
        } catch {}
    }

    // SELECT DROPDOWN
    const menuOptions = [];
    for (const q of allQuests.slice(0, 25)) {
        const opt = new StringSelectMenuOptionBuilder()
            .setLabel(shorten(q.game + ': ' + q.questName, 95))
            .setValue(String(q.id))
            .setDescription(`${q.progress.total}% Complete — Reward: 200 Orbs`)
            .setEmoji(parseEmoji(EMOJI.orbs));
        if (String(q.id) === String(selected.id)) opt.setDefault(true);
        menuOptions.push(opt);
    }
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('quest_select')
            .setPlaceholder(shorten(selected.game + ': ' + selected.questName, 100))
            .addOptions(menuOptions)
    ));

    // CONTROL BUTTONS
    const isRunning = customLogs && String(customLogs).toLowerCase().includes('fast mode');
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('quest_start_' + selected.id).setLabel('Start Task').setEmoji({ name: '▶️' }).setStyle(isRunning ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(isRunning ? true : false),
        new ButtonBuilder().setCustomId('quest_stop_' + selected.id).setLabel('Stop Task').setEmoji({ name: '⏹️' }).setStyle(isRunning ? ButtonStyle.Danger : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('quest_refresh').setLabel('Refresh UI').setEmoji({ name: '🔄' }).setStyle(ButtonStyle.Secondary)
    ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('View Quest on Discord').setEmoji(parseEmoji(EMOJI.links)).setStyle(ButtonStyle.Link).setURL(`https://discord.com/quests/${selected.id}`)
    ));

    // LOGS PANEL
    const logsContainer = new ContainerBuilder().setAccentColor(ACCENT);
    logsContainer.addTextDisplayComponents(text(`### ${EMOJI.list} ${selected.game} Solver Status Logs`));
    const now = new Date();
    const tStr = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    let rawLog = customLogs || `Quest initialized.\n[${tStr(now)}] Fast mode active.\n[${tStr(now)}] Current Progress -> ${selected.questName} [${selected.progress.total}%] [${progressBar(selected.progress.total)}]`;
    let cleanLog = String(rawLog).replace(/<a?:\w+:\d+>/g, '').replace(/:qdiamond:|:emoji_15:|:announce:/g, '').trim();
    logsContainer.addTextDisplayComponents(text('```prolog\n' + cleanLog.slice(0, 900) + '\n```'));

    return { components: [container, logsContainer], flags: MessageFlags.IsComponentsV2 };
}
