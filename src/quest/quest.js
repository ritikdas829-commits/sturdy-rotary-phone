
/**
 * quest.js — Quest Model Class
 * Location: src/quest/quest.js
 *
 * Features:
 * - Quest status management
 * - Task progress calculation
 * - Multiple progress data formats
 * - Enrollment, expiration and reward status
 * - Safe partial status updates
 */

export class Quest {
    #data;

    constructor(data = {}) {
        this.#data = { ...data };
    }

    static create(data) {
        return new Quest(data);
    }

    get id() {
        return this.#data.id;
    }

    get config() {
        return this.#data.config ?? {};
    }

    get userStatus() {
        return this.#data.user_status ?? null;
    }

    get targetedContent() {
        return this.#data.targeted_content;
    }

    get preview() {
        return this.#data.preview;
    }

    // -----------------------------
    // STATUS
    // -----------------------------

    isExpired(reference = new Date()) {
        const expiresAt = this.config?.expires_at;

        if (!expiresAt) return false;

        const expiry = new Date(expiresAt).getTime();

        if (!Number.isFinite(expiry)) return false;

        return reference.getTime() >= expiry;
    }

    isCompleted() {
        return Boolean(this.userStatus?.completed_at);
    }

    isEnrolledQuest() {
        return Boolean(this.userStatus?.enrolled_at);
    }

    hasClaimedRewards() {
        return Boolean(this.userStatus?.claimed_at);
    }

    getStatus() {
        if (this.hasClaimedRewards()) return 'CLAIMED';
        if (this.isCompleted()) return 'COMPLETED';
        if (this.isExpired()) return 'EXPIRED';
        if (this.isEnrolledQuest()) return 'IN_PROGRESS';

        return 'NOT_STARTED';
    }

    // -----------------------------
    // TASK PROGRESS
    // -----------------------------

    getTaskProgress(taskType, taskConfig = {}) {
        if (this.isCompleted()) return 100;

        const status = this.userStatus;

        if (!status) return 0;

        const target = Number(taskConfig?.target ?? 1);

        if (!Number.isFinite(target) || target <= 0) {
            return 0;
        }

        const eventName =
            taskConfig?.event_name ??
            taskConfig?.type ??
            taskType;

        const progress = status.progress ?? {};
        const details = status.details ?? {};

        const candidates = [
            details[taskType]?.progress,
            details[taskType]?.value,
            details[eventName]?.progress,
            details[eventName]?.value,

            progress[eventName]?.value,
            progress[eventName]?.progress,
            progress[eventName],

            progress[taskType]?.value,
            progress[taskType]?.progress,
            progress[taskType],
        ];

        let current = 0;

        for (const candidate of candidates) {
            if (candidate == null) continue;

            const rawValue =
                typeof candidate === 'object'
                    ? candidate.value ?? candidate.progress
                    : candidate;

            if (rawValue == null) continue;

            const number = Number(rawValue);

            if (Number.isFinite(number)) {
                current = Math.max(0, number);
                break;
            }
        }

        if (
            taskType === 'STREAM_ON_DESKTOP' &&
            status.stream_progress_seconds != null
        ) {
            const streamProgress = Number(
                status.stream_progress_seconds
            );

            if (Number.isFinite(streamProgress)) {
                current = Math.max(current, streamProgress);
            }
        }

        return Math.min(
            100,
            Math.floor((current / target) * 100)
        );
    }

    // -----------------------------
    // OVERALL PROGRESS
    // -----------------------------

    getProgress() {
        if (this.isCompleted()) return 100;

        const tasks =
            this.config?.task_config?.tasks ??
            this.config?.task_config_v2?.tasks ??
            {};

        const entries = Object.entries(tasks);

        if (!entries.length) return 0;

        const percentages = entries.map(([taskType, taskConfig]) =>
            this.getTaskProgress(taskType, taskConfig)
        );

        const total = percentages.reduce(
            (sum, percentage) => sum + percentage,
            0
        );

        // This is an estimate based on task percentages.
        return Math.floor(total / percentages.length);
    }

    // -----------------------------
    // UPDATE STATUS
    // -----------------------------

    updateUserStatus(userStatus) {
        if (
            !userStatus ||
            typeof userStatus !== 'object' ||
            Array.isArray(userStatus)
        ) {
            return;
        }

        const previous = this.#data.user_status ?? {};

        this.#data.user_status = {
            ...previous,
            ...userStatus,

            // Preserve existing progress entries if the
            // API sends only a partial progress update.
            ...(previous.progress || userStatus.progress
                ? {
                    progress: {
                        ...(previous.progress ?? {}),
                        ...(userStatus.progress ?? {}),
                    },
                }
                : {}),

            ...(previous.details || userStatus.details
                ? {
                    details: {
                        ...(previous.details ?? {}),
                        ...(userStatus.details ?? {}),
                    },
                }
                : {}),
        };
    }

    // -----------------------------
    // RAW DATA
    // -----------------------------

    toJSON() {
        return { ...this.#data };
    }
}
