#!/usr/bin/env node
/**
 * Fetches download & install statistics from Open VSX, VS Code Marketplace,
 * and GitHub Releases/Tags, then updates docs/data/stats.json and docs/data/badge.json.
 * Zero external dependencies — runs on Node.js 20+.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'site', 'data');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const BADGE_PATH = path.join(DATA_DIR, 'badge.json');

const NAMESPACE = 'EmorZz1G';
const EXTENSION = 'antigravity-agy-proxy';
const EXTENSION_ID = `${NAMESPACE}.${EXTENSION}`;
const GITHUB_REPO = `${NAMESPACE}/${EXTENSION}`;
const MAX_SNAPSHOTS = 1500;

function readExistingStats() {
    if (!fs.existsSync(STATS_PATH)) {
        return {
            extension: EXTENSION_ID,
            generatedAt: null,
            summary: {},
            milestones: [],
            daily: [],
            snapshots: []
        };
    }
    try {
        return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
    } catch {
        return {
            extension: EXTENSION_ID,
            generatedAt: null,
            summary: {},
            milestones: [],
            daily: [],
            snapshots: []
        };
    }
}

async function fetchJson(url, options = {}, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(20000)
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`);
            }
            return await res.json();
        } catch (err) {
            lastErr = err;
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
            }
        }
    }
    throw lastErr;
}

async function fetchOpenVsx() {
    const [meta, analytics] = await Promise.all([
        fetchJson(`https://open-vsx.org/api/${NAMESPACE}/${EXTENSION}`),
        fetchJson(`https://open-vsx.org/api/${NAMESPACE}/${EXTENSION}/analytics/downloads`)
    ]);

    return {
        downloadCount: Number(meta.downloadCount || 0),
        version: meta.version || null,
        averageRating: meta.averageRating ?? null,
        reviewCount: Number(meta.reviewCount || 0),
        points: Array.isArray(analytics.points)
            ? analytics.points.map(p => ({ date: String(p.t), count: Number(p.count || 0) }))
            : []
    };
}

async function fetchMarketplace() {
    const payload = {
        filters: [
            {
                criteria: [{ filterType: 7, value: EXTENSION_ID }],
                pageNumber: 1,
                pageSize: 1
            }
        ],
        assetTypes: [],
        // 0x100 (Statistics=256) | 0x10 (LatestVersionOnly=16) | 0x1 (IncludeVersions=1)
        flags: 273
    };

    const data = await fetchJson('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json;api-version=7.1-preview.1'
        },
        body: JSON.stringify(payload)
    });

    const ext = data?.results?.[0]?.extensions?.[0];
    if (!ext) {
        throw new Error(`Extension ${EXTENSION_ID} not found on VS Code Marketplace`);
    }

    const statMap = new Map();
    for (const s of ext.statistics || []) {
        statMap.set(s.statisticName, Number(s.value || 0));
    }

    const install = Math.round(statMap.get('install') || 0);
    const downloadCount = Math.round(statMap.get('downloadCount') || 0);
    const updateCount = Math.round(statMap.get('updateCount') || 0);

    return {
        install,
        downloadCount,
        updateCount,
        combined: install + downloadCount,
        weightedRating: statMap.get('weightedRating') ?? null,
        averageRating: statMap.get('averagerating') ?? null,
        ratingCount: Math.round(statMap.get('ratingcount') || 0),
        version: ext.versions?.[0]?.version || null
    };
}

async function fetchGitHubMilestones(existingMilestones) {
    const milestoneMap = new Map();
    for (const m of existingMilestones || []) {
        if (m.tag && m.date) {
            milestoneMap.set(m.tag, { tag: m.tag, date: m.date, name: m.name || m.tag, url: m.url || null });
        }
    }

    const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'antigravity-agy-proxy-stats-bot'
    };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    let stars = null;
    try {
        const repoInfo = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}`, { headers });
        if (typeof repoInfo.stargazers_count === 'number') {
            stars = repoInfo.stargazers_count;
        }
    } catch (err) {
        console.warn(`[warn] GitHub repo info unavailable: ${err.message}`);
    }

    try {
        const releases = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`, { headers });
        for (const rel of releases) {
            const tag = rel.tag_name;
            const date = (rel.published_at || rel.created_at || '').slice(0, 10);
            if (tag && date) {
                milestoneMap.set(tag, {
                    tag,
                    date,
                    name: rel.name || tag,
                    url: rel.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`
                });
            }
        }
    } catch (err) {
        console.warn(`[warn] GitHub releases API unavailable: ${err.message}`);
    }

    // Fallback to local git tags so first run works offline/rate-limited
    try {
        const tagOutput = execSync('git for-each-ref --sort=creatordate --format="%(refname:short)|%(creatordate:short)" refs/tags', {
            cwd: REPO_ROOT,
            encoding: 'utf8'
        }).trim();
        for (const line of tagOutput.split('\n').filter(Boolean)) {
            const [tag, date] = line.split('|');
            if (tag && date && !milestoneMap.has(tag)) {
                milestoneMap.set(tag, {
                    tag,
                    date,
                    name: tag,
                    url: `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`
                });
            }
        }
    } catch {
        // Ignore if git unavailable
    }

    const milestones = Array.from(milestoneMap.values()).sort((a, b) => a.date.localeCompare(b.date) || a.tag.localeCompare(b.tag));
    return { milestones, stars };
}

function toCompactNumber(n) {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (n >= 1000) {
        return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return String(n);
}

async function main() {
    const existing = readExistingStats();
    const now = new Date();
    const nowIso = now.toISOString();
    const todayUtc = nowIso.slice(0, 10);

    const [ovsxRes, mpRes, ghRes] = await Promise.allSettled([
        fetchOpenVsx(),
        fetchMarketplace(),
        fetchGitHubMilestones(existing.milestones)
    ]);

    if (ovsxRes.status === 'rejected') {
        console.warn(`[warn] Open VSX fetch failed: ${ovsxRes.reason?.message || ovsxRes.reason}`);
    }
    if (mpRes.status === 'rejected') {
        console.warn(`[warn] VS Marketplace fetch failed: ${mpRes.reason?.message || mpRes.reason}`);
    }
    if (ovsxRes.status === 'rejected' && mpRes.status === 'rejected') {
        throw new Error('Both Open VSX and VS Marketplace fetches failed');
    }

    const prevSummary = existing.summary || {};
    const ovsxData = ovsxRes.status === 'fulfilled' ? ovsxRes.value : null;
    const mpData = mpRes.status === 'fulfilled' ? mpRes.value : null;
    const ghData = ghRes.status === 'fulfilled' ? ghRes.value : { milestones: existing.milestones || [], stars: prevSummary.githubStars ?? null };

    const openvsxTotal = ovsxData ? ovsxData.downloadCount : Number(prevSummary.openvsxTotal || 0);
    const mpInstallTotal = mpData ? mpData.install : Number(prevSummary.marketplaceInstall || 0);
    const mpDownloadTotal = mpData ? mpData.downloadCount : Number(prevSummary.marketplaceDownload || 0);
    const mpUpdateTotal = mpData ? mpData.updateCount : Number(prevSummary.marketplaceUpdate || 0);
    const mpCombinedTotal = mpInstallTotal + mpDownloadTotal;
    const githubStars = ghData.stars ?? prevSummary.githubStars ?? null;

    // Index existing daily records
    const dailyMap = new Map();
    for (const row of existing.daily || []) {
        if (row && row.date) {
            dailyMap.set(row.date, { ...row });
        }
    }

    const ensureDay = (date) => {
        if (!dailyMap.has(date)) {
            dailyMap.set(date, {
                date,
                openvsx: 0,
                mpInstallTotal: null,
                mpDownloadTotal: null,
                mpUpdateTotal: null,
                mpInstall: 0,
                mpDownload: 0,
                mpUpdate: 0
            });
        }
        return dailyMap.get(date);
    };

    // Merge Open VSX daily series (keep non-zero history and any days already tracked or within recent 30 days)
    if (ovsxData) {
        const recentCutoff = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
        for (const pt of ovsxData.points) {
            if (pt.count > 0 || dailyMap.has(pt.date) || pt.date >= recentCutoff) {
                const entry = ensureDay(pt.date);
                entry.openvsx = pt.count;
            }
        }
    }

    // Record today's monotonic Marketplace cumulative ceiling
    const todayEntry = ensureDay(todayUtc);
    todayEntry.mpInstallTotal = Math.max(todayEntry.mpInstallTotal ?? 0, mpInstallTotal);
    todayEntry.mpDownloadTotal = Math.max(todayEntry.mpDownloadTotal ?? 0, mpDownloadTotal);
    todayEntry.mpUpdateTotal = Math.max(todayEntry.mpUpdateTotal ?? 0, mpUpdateTotal);

    // Recompute monotonic Marketplace daily deltas cleanly from earliest tracked Marketplace day
    const sortedDates = Array.from(dailyMap.keys()).sort();
    let prevMpInstall = null;
    let prevMpDownload = null;
    let prevMpUpdate = null;

    for (const date of sortedDates) {
        const entry = dailyMap.get(date);
        if (entry.mpInstallTotal !== null && entry.mpInstallTotal !== undefined) {
            entry.mpInstall = prevMpInstall === null
                ? entry.mpInstallTotal
                : Math.max(0, entry.mpInstallTotal - prevMpInstall);
            prevMpInstall = entry.mpInstallTotal;
        } else {
            entry.mpInstall = 0;
        }

        if (entry.mpDownloadTotal !== null && entry.mpDownloadTotal !== undefined) {
            entry.mpDownload = prevMpDownload === null
                ? entry.mpDownloadTotal
                : Math.max(0, entry.mpDownloadTotal - prevMpDownload);
            prevMpDownload = entry.mpDownloadTotal;
        } else {
            entry.mpDownload = 0;
        }

        if (entry.mpUpdateTotal !== null && entry.mpUpdateTotal !== undefined) {
            entry.mpUpdate = prevMpUpdate === null
                ? entry.mpUpdateTotal
                : Math.max(0, entry.mpUpdateTotal - prevMpUpdate);
            prevMpUpdate = entry.mpUpdateTotal;
        } else {
            entry.mpUpdate = 0;
        }
    }

    const daily = sortedDates.map(d => dailyMap.get(d));

    // Append point-in-time snapshot (skip duplicate if values unchanged and < 10 min since previous)
    const snapshots = Array.isArray(existing.snapshots) ? [...existing.snapshots] : [];
    const lastSnap = snapshots[snapshots.length - 1];
    const sameValues = lastSnap &&
        lastSnap.openvsxTotal === openvsxTotal &&
        lastSnap.mpInstall === mpInstallTotal &&
        lastSnap.mpDownload === mpDownloadTotal &&
        lastSnap.mpUpdate === mpUpdateTotal;
    const withinTenMin = lastSnap && (now.getTime() - new Date(lastSnap.ts).getTime() < 10 * 60_000);

    if (!sameValues || !withinTenMin) {
        snapshots.push({
            ts: nowIso,
            openvsxTotal,
            mpInstall: mpInstallTotal,
            mpDownload: mpDownloadTotal,
            mpUpdate: mpUpdateTotal,
            githubStars
        });
    }
    const trimmedSnapshots = snapshots.slice(-MAX_SNAPSHOTS);

    const summary = {
        openvsxTotal,
        marketplaceInstall: mpInstallTotal,
        marketplaceDownload: mpDownloadTotal,
        marketplaceUpdate: mpUpdateTotal,
        marketplaceCombined: mpCombinedTotal,
        combinedInstalls: openvsxTotal + mpInstallTotal,
        combinedAll: openvsxTotal + mpCombinedTotal,
        openvsxVersion: ovsxData?.version ?? prevSummary.openvsxVersion ?? null,
        marketplaceVersion: mpData?.version ?? prevSummary.marketplaceVersion ?? null,
        githubStars,
        lastUpdated: nowIso
    };

    const output = {
        extension: EXTENSION_ID,
        repository: `https://github.com/${GITHUB_REPO}`,
        generatedAt: nowIso,
        summary,
        milestones: ghData.milestones,
        daily,
        snapshots: trimmedSnapshots
    };

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATS_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');

    const badge = {
        schemaVersion: 1,
        label: 'total downloads',
        message: `${toCompactNumber(summary.combinedAll)} (OVSX ${toCompactNumber(openvsxTotal)} | VSM ${toCompactNumber(mpCombinedTotal)})`,
        color: '2563eb'
    };
    fs.writeFileSync(BADGE_PATH, JSON.stringify(badge, null, 2) + '\n', 'utf8');

    console.log(`Updated stats.json & badge.json at ${nowIso}`);
    console.log(`  Open VSX Total     : ${openvsxTotal} (version: ${summary.openvsxVersion})`);
    console.log(`  Marketplace Install: ${mpInstallTotal} | Web Download: ${mpDownloadTotal} | Update: ${mpUpdateTotal}`);
    console.log(`  Combined Total     : ${summary.combinedAll}`);
    console.log(`  Daily rows         : ${daily.length} | Snapshots: ${trimmedSnapshots.length} | Milestones: ${ghData.milestones.length}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
