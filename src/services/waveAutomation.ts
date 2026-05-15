/**
 * Wave Automation — runs every Sunday at 00:00 UTC.
 *
 * 1. Fetches merged PRs tagged #StellarShield-Guard from GitHub.
 * 2. Assigns points: 1000 for logic changes, 500 for docs.
 * 3. Logs the point set (push to Drips Wave contract when SDK is available).
 */

const LABEL = 'StellarShield-Guard';
const POINTS = { logic: 1000, docs: 500 };

interface PrContribution {
  author: string;
  title: string;
  url: string;
  points: number;
  mergedAt: string;
}

async function fetchMergedPRs(since: string): Promise<PrContribution[]> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    console.warn('[wave] GITHUB_TOKEN or GITHUB_REPO not set — skipping PR scan');
    return [];
  }

  const url = `https://api.github.com/repos/${repo}/pulls?state=closed&per_page=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });

  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const prs = (await res.json()) as any[];

  return prs
    .filter((pr) => {
      if (!pr.merged_at || pr.merged_at < since) return false;
      return (pr.labels as any[]).some((l: any) => l.name === LABEL);
    })
    .map((pr) => {
      const isDoc = /doc|readme|comment/i.test(pr.title);
      return {
        author: pr.user.login,
        title: pr.title,
        url: pr.html_url,
        points: isDoc ? POINTS.docs : POINTS.logic,
        mergedAt: pr.merged_at,
      };
    });
}

async function runWaveCycle() {
  console.log('[wave] Starting weekly Wave automation cycle');

  // Look back 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const contributions = await fetchMergedPRs(since);
    if (contributions.length === 0) {
      console.log('[wave] No new contributions this week');
      return;
    }

    // Aggregate points per contributor
    const totals: Record<string, number> = {};
    for (const c of contributions) {
      totals[c.author] = (totals[c.author] ?? 0) + c.points;
      console.log(`[wave] +${c.points} pts → ${c.author} (${c.title})`);
    }

    console.log('[wave] Point summary:', totals);

    // TODO: call Drips Wave contract to push point-set once @drips-network/sdk
    // supports Soroban. Shape: DripsClient.setPoints(totals)
  } catch (err: any) {
    console.error('[wave] cycle error:', err.message);
  }
}

/** Schedule wave automation to run every Sunday at 00:00 UTC. */
export function scheduleWaveAutomation() {
  const msUntilNextSunday = () => {
    const now = new Date();
    const day = now.getUTCDay(); // 0 = Sunday
    const daysUntil = day === 0 ? 7 : 7 - day;
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + daysUntil);
    next.setUTCHours(0, 0, 0, 0);
    return next.getTime() - now.getTime();
  };

  const scheduleNext = () => {
    const delay = msUntilNextSunday();
    console.log(`[wave] Next cycle in ${Math.round(delay / 3_600_000)} h`);
    setTimeout(() => {
      runWaveCycle();
      setInterval(runWaveCycle, 7 * 24 * 60 * 60 * 1000);
    }, delay);
  };

  scheduleNext();
}
