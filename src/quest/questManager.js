/**
 * questManager.js — Complete Manager with Game Heartbeats, Video Progression & Live Progress Callback
 * Location: src/quest/questManager.js
 */

import { Quest } from './quest.js';

const EXCLUDED_QUEST_ID = '1412491570820812933';

const QuestTaskConfigType = {
    WATCH_VIDEO:           'WATCH_VIDEO',
    PLAY_ON_DESKTOP:       'PLAY_ON_DESKTOP',
    STREAM_ON_DESKTOP:     'STREAM_ON_DESKTOP',
    PLAY_ACTIVITY:         'PLAY_ACTIVITY',
    WATCH_VIDEO_ON_MOBILE: 'WATCH_VIDEO_ON_MOBILE',
};

function safeLog(log, message) {
    try {
        if (typeof log === 'function') {
            log(message);
        } else {
            console.log(message);
        }
    } catch {
        // Logging failure must not crash quest execution.
    }
}

function extractStatus(res) {
    if (res && typeof res === 'object' && 'user_status' in res && res.user_status) {
        return res.user_status;
    }
    return res;
}

function readProgress(quest, eventName, taskName) {
    const progress = quest.userStatus?.progress;
    if (!progress) return 0;
    const byEvent = eventName ? progress[eventName]?.value : undefined;
    const byTask  = progress[taskName]?.value;
    return Number(byEvent ?? byTask ?? 0) || 0;
}

export class QuestManager {
    #quests = new Map();
    client;

    constructor(client, quests = []) {
        this.client = client;
        for (const quest of quests) {
            if (quest?.id) {
                this.#quests.set(quest.id, quest);
            }
        }
    }

    static fromResponse(client, response) {
        const questsArray = Array.isArray(response) 
            ? response 
            : (response?.quests || response?.items || []);
            
        return new QuestManager(
            client,
            questsArray.map((quest) => Quest.create(quest)),
        );
    }

    [Symbol.iterator]() { return this.#quests.values(); }
    get size() { return this.#quests.size; }
    list() { return Array.from(this.#quests.values()); }
    get(id) { return this.#quests.get(id); }
    upsert(quest) { 
        if (quest?.id) this.#quests.set(quest.id, quest); 
    }
    remove(id) { return this.#quests.delete(id); }
    clear() { this.#quests.clear(); }
    hasQuest(id) { return this.#quests.has(id); }

    getExpired(date = new Date()) {
        return this.list().filter((q) => q.isExpired(date));
    }
    getCompleted() {
        return this.list().filter((q) => q.isCompleted());
    }
    getClaimable() {
        return this.list().filter((q) => q.isCompleted() && !q.hasClaimedRewards() && !q.isExpired());
    }
    filterQuestsValid() {
        return this.list().filter(
            (q) => q.id !== EXCLUDED_QUEST_ID && !q.isCompleted() && !q.isExpired(),
        );
    }

    // ------------------------------------------
    // REWARDS CLAIM
    // ------------------------------------------

    async claimRewards(log = console.log) {
        try {
            const fresh = await this.client.get('/quests/@me');
            const freshQuests = Array.isArray(fresh) ? fresh : (fresh?.quests || []);
            for (const q of freshQuests) {
                const existing = this.#quests.get(q.id);
                if (existing && q.user_status) existing.updateUserStatus(q.user_status);
            }
        } catch (err) {
            safeLog(log, `[Claim] Refresh status warning: ${err.message}`);
        }

        const claimable = this.getClaimable();
        let claimed = 0;

        for (const quest of claimable) {
            const questName = quest.config?.messages?.quest_name || quest.id;
            try {
                await this.client.post(`/quests/${encodeURIComponent(quest.id)}/claim-reward`);
                claimed++;
                safeLog(log, `[Claim] Claimed reward for "${questName}"`);
            } catch (err) {
                safeLog(log, `[Claim] Could not claim reward for "${questName}": ${err.message}`);
            }
        }
        return claimed;
    }

    // ------------------------------------------
    // ENROLLMENT
    // ------------------------------------------

    async acceptQuest(questId) {
        const r = await this.client.post(`/quests/${encodeURIComponent(questId)}/enroll`, {
            location: 11,
            is_targeted: false,
            metadata_raw: null,
        });
        const quest = this.get(questId);
        quest?.updateUserStatus(extractStatus(r));
        return quest;
    }

    #timeout(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async #refreshQuestStatus(quest) {
        try {
            const fresh = await this.client.get('/quests/@me');
            const freshQuests = Array.isArray(fresh) ? fresh : (fresh?.quests || []);
            const updated = freshQuests.find((q) => q.id === quest.id);
            if (updated?.user_status) quest.updateUserStatus(updated.user_status);
        } catch { /* Best effort refresh */ }
    }

    // ------------------------------------------
    // QUEST EXECUTION (WITH LIVE PROGRESS)
    // ------------------------------------------

    async doingQuest(quest, log = console.log, onProgress = null) {
        if (!quest) {
            safeLog(log, '[Quest] Quest not found.');
            return false;
        }

        const questName = quest.config?.messages?.quest_name || quest.id;

        if (quest.id === EXCLUDED_QUEST_ID) {
            safeLog(log, `[Quest] "${questName}" is excluded.`);
            return false;
        }

        if (quest.isExpired()) {
            safeLog(log, `[Quest] "${questName}" has expired.`);
            return false;
        }

        if (quest.hasClaimedRewards()) {
            safeLog(log, `[Quest] "${questName}" is already claimed.`);
            return true;
        }

        if (quest.isCompleted()) {
            safeLog(log, `[Quest] "${questName}" is already completed.`);
            return true;
        }

        // Auto-Enrollment
        if (!quest.isEnrolledQuest()) {
            safeLog(log, `[Quest] Enrolling in quest "${questName}"...`);
            try {
                await this.acceptQuest(quest.id);
            } catch (err) {
                safeLog(log, `[Quest] Could not enroll in "${questName}": ${err.message}`);
                return false;
            }
        }

        const taskConfig = quest.config?.task_config ?? quest.config?.task_config_v2;
        if (!taskConfig) {
            safeLog(log, `[FAIL] "${questName}": task_config is missing from Discord's response.`);
            return false;
        }

        const tasks = taskConfig.tasks ?? {};
        const allKeys = Object.keys(tasks);
        safeLog(log, `[INFO] "${questName}": task keys = [${allKeys.join(', ')}]`);

        const TASK_TYPES = Object.values(QuestTaskConfigType);
        const taskName = TASK_TYPES.find((x) => tasks[x] != null);

        if (!taskName) {
            safeLog(log, `[FAIL] "${questName}": unsupported task type(s) [${allKeys.join(', ')}].`);
            return false;
        }

        safeLog(log, `[INFO] "${questName}": using task type "${taskName}"`);

        const task = tasks[taskName];
        const secondsNeeded = Number(task?.target ?? 30);
        const eventName = task?.event_name ?? task?.type ?? taskName;
        const applicationName = quest.config?.application?.name || 'Application';

        // Initial progress report
        if (typeof onProgress === 'function') {
            await onProgress(0, secondsNeeded);
        }

        // ------------------------------------------
        // WATCH VIDEO & WATCH VIDEO ON MOBILE
        // ------------------------------------------
        if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
            const maxFuture = 10, speed = 7, interval = 1;
            const enrolledAt = quest.userStatus?.enrolled_at
                ? new Date(quest.userStatus.enrolled_at).getTime()
                : Date.now();

            let secondsDone = readProgress(quest, eventName, taskName);

            while (true) {
                const elapsed = Math.floor((Date.now() - enrolledAt) / 1000);
                const maxAllowed = elapsed + maxFuture;
                const diff = maxAllowed - secondsDone;
                const timestamp = secondsDone + speed;

                if (diff >= speed) {
                    try {
                        const res = await this.client.post(`/quests/${encodeURIComponent(quest.id)}/video-progress`, {
                            timestamp: Math.min(secondsNeeded, timestamp + Math.random()),
                        });
                        
                        quest.updateUserStatus(extractStatus(res));
                        secondsDone = Math.min(secondsNeeded, timestamp);

                        if (typeof onProgress === 'function') {
                            await onProgress(secondsDone, secondsNeeded);
                        }

                        if (res?.completed_at || res?.user_status?.completed_at || quest.isCompleted()) {
                            break;
                        }
                    } catch (err) {
                        safeLog(log, `Video progress beat failed for "${questName}": ${err.message}. Retrying...`);
                    }
                }

                if (secondsDone >= secondsNeeded) break;
                await this.#timeout(interval * 1000);
            }

            try {
                const finalRes = await this.client.post(`/quests/${encodeURIComponent(quest.id)}/video-progress`, { timestamp: secondsNeeded });
                quest.updateUserStatus(extractStatus(finalRes));
            } catch { /* Best effort */ }

            if (typeof onProgress === 'function') {
                await onProgress(secondsNeeded, secondsNeeded);
            }

            safeLog(log, `Quest "${questName}" completed!`);
            return true;

        // ------------------------------------------
        // PLAY ON DESKTOP (GAME HEARTBEAT SPOOFING)
        // ------------------------------------------
        } else if (taskName === 'PLAY_ON_DESKTOP') {
            const interval = 30;
            const maxDurationMs = (secondsNeeded + 600) * 1000;
            const startTime = Date.now();
            let beats = 0, consecutiveErrors = 0;

            while (!quest.isCompleted()) {
                if (Date.now() - startTime > maxDurationMs) {
                    safeLog(log, `Quest "${questName}" timed out.`);
                    try {
                        const res = await this.client.post(`/quests/${encodeURIComponent(quest.id)}/heartbeat`, { stream_key: null, terminal: true });
                        quest.updateUserStatus(extractStatus(res));
                    } catch { /* ignore */ }
                    return true;
                }

                try {
                    const res = await this.client.post(`/quests/${encodeURIComponent(quest.id)}/heartbeat`, { stream_key: null, terminal: false });
                    quest.updateUserStatus(extractStatus(res));
                    consecutiveErrors = 0;
                } catch (err) {
                    consecutiveErrors++;
                    safeLog(log, `Heartbeat failed for "${questName}" (attempt ${consecutiveErrors}): ${err.message}`);
                    if (consecutiveErrors >= 5) { 
                        safeLog(log, `Too many heartbeat failures for "${questName}". Giving up.`); 
                        return false; 
                    }
                    await this.#timeout(5_000);
                    continue;
                }

                beats++;
                if (beats % 5 === 0) await this.#refreshQuestStatus(quest);

                const done = readProgress(quest, eventName, taskName);
                if (typeof onProgress === 'function') {
                    await onProgress(done, secondsNeeded);
                }

                const remaining = Math.max(0, secondsNeeded - done);
                safeLog(log, `Spoofed game to ${applicationName}. About ${Math.ceil(remaining / 60)} more minute(s) to go.`);

                if (done >= secondsNeeded || quest.isCompleted()) break;
                await this.#timeout(interval * 1000);
            }

            try {
                const res = await this.client.post(`/quests/${encodeURIComponent(quest.id)}/heartbeat`, { stream_key: null, terminal: true });
                quest.updateUserStatus(extractStatus(res));
            } catch { /* Best effort */ }

            if (typeof onProgress === 'function') {
                await onProgress(secondsNeeded, secondsNeeded);
            }

            safeLog(log, `Quest "${questName}" completed!`);
            return true;

        // ------------------------------------------
        // UNSUPPORTED NATIVE TASKS
        // ------------------------------------------
        } else if (taskName === 'STREAM_ON_DESKTOP') {
            safeLog(log, `Stream quests cannot be completed automatically. Use the Discord desktop app for "${questName}".`);
            return false;
        } else if (taskName === 'PLAY_ACTIVITY') {
            safeLog(log, `Activity quests are not supported. Use the Discord desktop app for "${questName}".`);
            return false;
        }

        return true;
    }
}
