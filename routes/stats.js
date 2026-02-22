const express = require('express');
const { getDb } = require('../db/index');

const router = express.Router();

function today() {
  return new Date().toISOString().split('T')[0];
}

// GET /api/stats/dashboard
router.get('/dashboard', (req, res) => {
  try {
    const db = getDb();

    // Today's stats
    const todayStats = db.prepare(
      'SELECT * FROM daily_stats WHERE date = ?'
    ).get(today()) || {
      drills_completed: 0, drills_correct: 0, accuracy_rate: 0,
      voice_drills: 0, typed_drills: 0,
    };

    // Streak: consecutive days with streak_day = TRUE ending at today or yesterday
    const streakRows = db.prepare(
      'SELECT date FROM daily_stats WHERE streak_day = TRUE ORDER BY date DESC LIMIT 60'
    ).all();

    let streak = 0;
    const d = new Date();
    for (const row of streakRows) {
      const expected = d.toISOString().split('T')[0];
      if (row.date === expected) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        // Allow today to be missing (haven't practiced yet today)
        if (streak === 0) {
          d.setDate(d.getDate() - 1);
          if (row.date === d.toISOString().split('T')[0]) {
            streak++;
            d.setDate(d.getDate() - 1);
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }

    // Vocab production status
    const vocabCounts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN production_status != 'never_attempted' THEN 1 ELSE 0 END) as attempted,
        SUM(CASE WHEN production_status IN ('produced_once', 'consistently_produced') THEN 1 ELSE 0 END) as produced
      FROM vocabulary_status
    `).get();

    // Vocab tier counts
    const tierCounts = db.prepare(`
      SELECT jpdb_tier, COUNT(*) as count
      FROM vocabulary_status GROUP BY jpdb_tier
    `).all();

    // Grammar production status
    const grammarCounts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN production_status != 'never_attempted' THEN 1 ELSE 0 END) as attempted,
        SUM(CASE WHEN production_status IN ('sometimes_correct', 'reliable') THEN 1 ELSE 0 END) as reliable
      FROM grammar_status
    `).get();

    // Weakest grammar patterns (highest error rate among drilled patterns)
    const weakestPatterns = db.prepare(`
      SELECT pattern_name, bunpro_level, bunpro_accuracy, error_count, times_drilled, times_correct
      FROM grammar_status
      WHERE bunpro_accuracy IS NOT NULL
      ORDER BY bunpro_accuracy ASC, error_count DESC
      LIMIT 5
    `).all();

    // Weekly trend (last 7 days)
    const weeklyTrend = db.prepare(`
      SELECT date, drills_completed, drills_correct, accuracy_rate
      FROM daily_stats
      WHERE date >= date('now', '-7 days')
      ORDER BY date ASC
    `).all();

    // Total drills all time
    const totalDrills = db.prepare(
      'SELECT COUNT(*) as count FROM drill_results'
    ).get();

    // Free production stats today
    const freeToday = db.prepare(
      `SELECT COUNT(*) as completed,
              SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct
       FROM drill_results
       WHERE drill_type = 'free_production' AND date(timestamp) = ?`
    ).get(today()) || { completed: 0, correct: 0 };

    // Targeted drill stats today
    const targetedToday = db.prepare(
      `SELECT COUNT(*) as completed,
              SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct
       FROM drill_results
       WHERE (drill_type = 'targeted' OR drill_type IS NULL) AND date(timestamp) = ?`
    ).get(today()) || { completed: 0, correct: 0 };

    res.json({
      streak,
      today: todayStats,
      free_today: freeToday,
      targeted_today: targetedToday,
      vocabulary: { ...vocabCounts, tiers: tierCounts },
      grammar: grammarCounts,
      weakest_patterns: weakestPatterns,
      weekly_trend: weeklyTrend,
      total_drills: totalDrills.count,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard', detail: err.message });
  }
});

module.exports = router;
