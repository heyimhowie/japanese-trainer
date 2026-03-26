const express = require('express');
const { getDb } = require('../db/index');

const router = express.Router();

// GET /api/history — list drill results with filters + pagination
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const type = req.query.type || 'all';
    const domain = req.query.domain || '';
    const from = req.query.from || '';
    const to = req.query.to || '';
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    let where = '1=1';
    const params = [];

    if (type === 'targeted') {
      where += " AND (drill_type = 'targeted' OR drill_type IS NULL)";
    } else if (type === 'free') {
      where += " AND drill_type = 'free_production'";
    }

    if (domain) {
      where += ' AND life_domain = ?';
      params.push(domain);
    }

    if (from) {
      where += ' AND date(timestamp) >= ?';
      params.push(from);
    }

    if (to) {
      where += ' AND date(timestamp) <= ?';
      params.push(to);
    }

    const items = db.prepare(`
      SELECT id, timestamp, drill_type, mode, english_prompt, japanese_prompt,
             user_response, is_correct, life_domain, difficulty_tier, response_time_seconds
      FROM drill_results
      WHERE ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit + 1, offset);

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    res.json({ items, has_more: hasMore });
  } catch (err) {
    console.error('History list error:', err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// GET /api/history/:id — single drill with parsed JSON fields
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });

    const row = db.prepare('SELECT * FROM drill_results WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    // Parse JSON fields safely
    const jsonFields = ['errors', 'vocabulary_used', 'grammar_used', 'follow_up_qa'];
    for (const field of jsonFields) {
      if (row[field]) {
        try { row[field] = JSON.parse(row[field]); }
        catch { row[field] = null; }
      }
    }

    res.json(row);
  } catch (err) {
    console.error('History detail error:', err);
    res.status(500).json({ error: 'Failed to load drill detail' });
  }
});

module.exports = router;
