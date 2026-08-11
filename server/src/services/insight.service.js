import { pool } from '../config/db.js';
import { aiService } from './ai/index.js';
import { logger } from '../utils/logger.js';

function fallbackSummary(insights) {
  if (!insights.length) return '';
  const first = insights.slice(0, 2).map((i) => i.headline.toLowerCase()).join('; ');
  return `This week's highlights: ${first}.`;
}

/**
 * AI civic insights — generated exclusively from actual database data.
 * Returns an empty list when there is not enough data; never fabricates numbers.
 */
export const insightService = {
  async generate() {
    const insights = [];

    const { rows: minCheck } = await pool.query(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS recent
         FROM issues WHERE is_hidden = false`,
    );
    const total = minCheck[0]?.n || 0;
    const recent = minCheck[0]?.recent || 0;
    if (total < 15 || recent < 5) {
      return { insights: [], note: 'Not enough report data yet to generate insights.' };
    }

    const { rows: hotspotRows } = await pool.query(`
      SELECT c.name AS category, c.slug,
             round(i.lat * 40) / 40 AS lat, round(i.lng * 40) / 40 AS lng,
             COUNT(*)::int AS n
        FROM issues i JOIN categories c ON c.id = i.category_id
       WHERE i.is_hidden = false
       GROUP BY 1, 2, 3, 4
      HAVING COUNT(*) >= 5
       ORDER BY n DESC LIMIT 3
    `);
    for (const h of hotspotRows) {
      insights.push({
        type: 'hotspot',
        severity: h.n >= 10 ? 'warning' : 'info',
        headline: `${h.n} reports of ${h.category.toLowerCase()} concentrated around one area`,
        detail: `A nearby cluster (lat ${h.lat.toFixed(3)}, lng ${h.lng.toFixed(3)}) shows repeated reports of the same problem type.`,
        evidence: { count: h.n, category: h.category, lat: h.lat, lng: h.lng },
      });
    }

    const { rows: growthRows } = await pool.query(`
      SELECT c.name AS category,
             COUNT(*) FILTER (WHERE i.created_at >= now() - interval '30 days')::int AS last30,
             COUNT(*) FILTER (WHERE i.created_at >= now() - interval '60 days' AND i.created_at < now() - interval '30 days')::int AS prev30
        FROM issues i JOIN categories c ON c.id = i.category_id
       WHERE i.is_hidden = false
       GROUP BY c.id, c.name
      HAVING COUNT(*) FILTER (WHERE i.created_at >= now() - interval '30 days') >= 5
    `);
    for (const g of growthRows) {
      if (g.prev30 > 0) {
        const pct = Math.round(((g.last30 - g.prev30) / g.prev30) * 100);
        if (pct >= 30) {
          insights.push({
            type: 'trend',
            severity: 'warning',
            headline: `${g.category} reports increased ${pct}% in the last 30 days`,
            detail: `${g.last30} reports in the past month versus ${g.prev30} in the month before.`,
            evidence: { category: g.category, last30: g.last30, prev30: g.prev30, pct },
          });
        }
      }
    }

    const { rows: reopenRows } = await pool.query(`
      SELECT i.public_id, i.title, i.area,
             COUNT(h.id) FILTER (WHERE h.to_status = 'REOPENED')::int AS reopens,
             MAX(i.reopened_at) AS last_reopened
        FROM issues i
        JOIN issue_status_history h ON h.issue_id = i.id
       WHERE i.is_hidden = false
       GROUP BY i.id
      HAVING COUNT(h.id) FILTER (WHERE h.to_status = 'REOPENED') >= 2
       ORDER BY reopens DESC LIMIT 3
    `);
    for (const r of reopenRows) {
      insights.push({
        type: 'reopen',
        severity: 'warning',
        headline: `Issue #${r.public_id} has been reopened ${r.reopens} times`,
        detail: `"${r.title}" reappeared after being marked resolved. Repeat occurrences may indicate an incomplete fix.`,
        evidence: { publicId: r.public_id, reopens: r.reopens, area: r.area },
      });
    }

    const { rows: weekendRows } = await pool.query(`
      SELECT EXTRACT(DOW FROM created_at)::int AS dow, COUNT(*)::int AS n
        FROM issues WHERE is_hidden = false
       GROUP BY 1
    `);
    if (weekendRows.length >= 5) {
      const sum = weekendRows.reduce((a, r) => a + r.n, 0);
      const weekend = weekendRows.filter((r) => r.dow === 0 || r.dow === 6).reduce((a, r) => a + r.n, 0);
      const weekendPct = Math.round((weekend / sum) * 100);
      if (weekendPct >= 35) {
        insights.push({
          type: 'pattern',
          severity: 'info',
          headline: `${weekendPct}% of reports come in on weekends`,
          detail: 'Weekend reporting peaks may reflect damage noticed during personal travel.',
          evidence: { weekendPct, total: sum },
        });
      }
    }

    const { rows: deptRows } = await pool.query(`
      SELECT d.name AS department,
             COUNT(i.id) FILTER (WHERE i.status NOT IN ('RESOLVED','VERIFIED_RESOLVED','REJECTED'))::int AS open,
             COUNT(i.id)::int AS total
        FROM departments d
        LEFT JOIN issues i ON i.department_id = d.id AND i.is_hidden = false
       GROUP BY d.id, d.name
      HAVING COUNT(i.id) FILTER (WHERE i.status NOT IN ('RESOLVED','VERIFIED_RESOLVED','REJECTED')) >= 10
       ORDER BY open DESC LIMIT 3
    `);
    for (const d of deptRows) {
      insights.push({
        type: 'load',
        severity: d.open >= 25 ? 'warning' : 'info',
        headline: `${d.department} carries ${d.open} open issues`,
        detail: `${d.open} of ${d.total} issues assigned to ${d.department} remain open.`,
        evidence: { department: d.department, open: d.open, total: d.total },
      });
    }

    const topInsights = insights.slice(0, 6);
    let summary = null;
    let summaryProvider = null;
    let generatedAt = null;
    if (topInsights.length) {
      try {
        const s = await aiService.summarizeInsights({ insights: topInsights });
        summary = s.summary || fallbackSummary(topInsights);
        summaryProvider = s.provider;
        generatedAt = new Date().toISOString();
      } catch (err) {
        logger.warn('AI insight summary failed, using fallback', err.message);
        summary = fallbackSummary(topInsights);
      }
    }

    return { insights: topInsights, note: null, summary, summaryProvider, generatedAt };
  },
};
