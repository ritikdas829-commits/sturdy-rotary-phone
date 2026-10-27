/**
 * questClient.js — Updated & Optimized with Full Browser Headers & Timeouts
 * Location: src/quest/questClient.js
 */

import { Constants } from './constants.js';
import { QuestManager } from './questManager.js';

const BASE_URL = 'https://discord.com/api/v10';
const BASE_URL_V9 = 'https://discord.com/api/v9';

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRY_DELAY_MS = 60_000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(response, attempt) {
    const retryAfter = Number(response.headers.get('retry-after'));

    if (Number.isFinite(retryAfter) && retryAfter >= 0) {
        return Math.min(
            retryAfter * 1000,
            MAX_RETRY_DELAY_MS
        );
    }

    return Math.min(
        1000 * (2 ** attempt),
        MAX_RETRY_DELAY_MS
    );
}

async function readResponse(response) {
    const text = await response.text();

    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function createHttpError(status, payload, statusText, method, path) {
    const message =
        payload && typeof payload === 'object'
            ? payload.message ?? statusText
            : String(payload ?? statusText);

    const error = new Error(`HTTP_${status}: ${message}`);

    error.status = status;
    error.code =
        payload && typeof payload === 'object'
            ? payload.code
            : undefined;
    error.method = method;
    error.path = path;

    return error;
}

export class QuestClient {
    #token;

    questManager = null;

    constructor(userToken) {
        if (
            typeof userToken !== 'string' ||
            !userToken.trim()
        ) {
            throw new Error(
                'INVALID_TOKEN: A non-empty token is required.'
            );
        }

        this.#token = userToken.trim();
    }

    #buildHeaders() {
        return {
            'Authorization':      this.#token,
            'User-Agent':         Constants.USER_AGENT,
            'Content-Type':       'application/json',
            'accept':             'application/json',
            'accept-language':    'vi',
            'origin':             'https://discord.com',
            'pragma':             'no-cache',
            'priority':           'u=1, i',
            'referer':            'https://discord.com/channels/@me',
            'sec-ch-ua':          '"Not)A;Brand";v="8", "Chromium";v="138"',
            'sec-ch-ua-mobile':   '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest':     'empty',
            'sec-fetch-mode':     'cors',
            'sec-fetch-site':     'same-origin',
            'x-debug-options':    'bugReporterEnabled',
            'x-discord-locale':   'en-US',
            'x-discord-timezone': 'Asia/Saigon',
            'x-super-properties': Buffer.from(
                JSON.stringify(Constants.Properties)
            ).toString('base64'),
        };
    }

    #buildUrl(path, query) {
        if (
            typeof path !== 'string' ||
            !path.startsWith('/') ||
            path.startsWith('//')
        ) {
            throw new Error(
                'INVALID_PATH: Expected an API path starting with /.'
            );
        }

        const url = new URL(`${BASE_URL}${path}`);

        if (query) {
            if (typeof query === 'string') {
                url.search = query;
            } else if (
                typeof query === 'object' &&
                !Array.isArray(query)
            ) {
                for (const [key, value] of Object.entries(query)) {
                    if (value !== undefined && value !== null) {
                        url.searchParams.set(key, String(value));
                    }
                }
            } else {
                throw new Error(
                    'INVALID_QUERY: Expected a string or object.'
                );
            }
        }

        return url;
    }

    async #request(method, path, body, query) {
        const url = this.#buildUrl(path, query);

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            let response;

            try {
                response = await fetch(url, {
                    method,
                    headers: this.#buildHeaders(),
                    body: body !== undefined
                        ? JSON.stringify(body)
                        : undefined,
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
            } catch (error) {
                if (attempt < MAX_RETRIES) {
                    await sleep(
                        Math.min(
                            1000 * (2 ** attempt),
                            MAX_RETRY_DELAY_MS
                        )
                    );
                    continue;
                }

                throw new Error(
                    `NETWORK_ERROR: ${method} ${path} failed: ${error.message}`
                );
            }

            if (response.status === 429) {
                const delay = getRetryDelay(response, attempt);
                if (attempt < MAX_RETRIES) {
                    await sleep(delay);
                    continue;
                }

                const payload = await readResponse(response);

                throw createHttpError(
                    response.status,
                    payload,
                    response.statusText,
                    method,
                    path
                );
            }

            if (!response.ok) {
                if (
                    RETRYABLE.has(response.status) &&
                    attempt < MAX_RETRIES
                ) {
                    const delay = getRetryDelay(response, attempt);
                    await sleep(delay);
                    continue;
                }

                const payload = await readResponse(response);

                throw createHttpError(
                    response.status,
                    payload,
                    response.statusText,
                    method,
                    path
                );
            }

            return readResponse(response);
        }

        throw new Error(
            `MAX_RETRIES: ${method} ${path} failed after retries.`
        );
    }

    async get(path, query) {
        return this.#request('GET', path, undefined, query);
    }

    async post(path, body) {
        return this.#request('POST', path, body);
    }

    async rawCall(method, path, body, base = 'v10') {
        const baseUrl =
            base === 'v9' ? BASE_URL_V9 : BASE_URL;

        if (
            typeof path !== 'string' ||
            !path.startsWith('/') ||
            path.startsWith('//')
        ) {
            return {
                status: 0,
                text: 'INVALID_PATH',
            };
        }

        try {
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers: this.#buildHeaders(),
                body: body !== undefined
                    ? JSON.stringify(body)
                    : undefined,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });

            return {
                status: response.status,
                text: await response.text(),
            };
        } catch (error) {
            return {
                status: 0,
                text: error?.message ?? 'Network error',
            };
        }
    }

    async fetchQuests() {
        const response = await this.get('/quests/@me');

        const quests = Array.isArray(response)
            ? response
            : response?.quests ?? response?.items;

        if (!Array.isArray(quests)) {
            throw new Error(
                'INVALID_RESPONSE: Quest API did not return a quest list.'
            );
        }

        this.questManager = QuestManager.fromResponse(
            this,
            response
        );

        return this.questManager;
    }

    async fetchQuestsRaw() {
        return this.get('/quests/@me');
    }

    async fetchUserRaw() {
        return this.get('/users/@me');
    }
}
