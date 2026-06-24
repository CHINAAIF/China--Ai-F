import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

var app = express();
var PORT = process.env.PORT || 8080;

/* ===== DB POOL ===== */
function fixDbUrl(url) {
  if (!url) return null;
  var parts = url.split('?');
  if (parts.length < 2) return url;
  var params = parts[1].split('&');
  var filtered = [];
  for (var i = 0; i < params.length; i++) {
    if (params[i].indexOf('channel_binding=') !== 0) {
      filtered.push(params[i]);
    }
  }
  return parts[0] + '?' + filtered.join('&');
}

var pool = null;
function getPool() {
  if (!pool) {
    var dbUrl = fixDbUrl(process.env.DATABASE_URL);
    if (!dbUrl) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

/* ===== SYSTEM ROUTES ===== */
app.get('/health', function(req, res) {
  res.json({ status: 'ok', port: PORT, phase: 3, endpoints: 7, time: new Date().toISOString() });
});

app.get('/ping', function(req, res) {
  res.json({ pong: true, ts: Date.now() });
});

/* ===== 1. GEOPOLITICAL RISK ===== */
app.get('/api/intelligence/geopolitical/:slug', async function(req, res) {
  try {
    var slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: 'slug is required' });

    var r = await getPool().query(
      "SELECT m.slug, m.name, g.country_of_origin, g.risk_score, g.data_law_risk, g.sanctions_risk, g.blocking_risk, g.censorship_risk, g.notes, g.assessed_at FROM model_geopolitical_risk g JOIN models m ON g.model_id = m.id WHERE m.slug = $1",
      [slug]
    );

    if (!r || !r.rows || r.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found', slug: slug });
    }

    res.json({ model: r.rows[0] });
  } catch (e) {
    console.error('[geopolitical]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ===== 2. COST CALCULATE ===== */
app.get('/api/intelligence/cost-calculate', async function(req, res) {
  try {
    var slug = req.query.slug;
    var tokens = parseInt(req.query.tokens, 10);

    if (!slug) return res.status(400).json({ error: 'slug query param is required' });
    if (!tokens || tokens <= 0) return res.status(400).json({ error: 'tokens must be a positive number' });

    var r = await getPool().query(
      "SELECT m.slug, m.name, p.tier_name, p.pricing_model, p.currency, p.price, p.min_usage, p.max_usage, p.features, p.availability FROM model_pricing_tiers p JOIN models m ON p.model_id = m.id WHERE m.slug = $1 AND p.active = true AND p.deleted_at IS NULL ORDER BY p.min_usage ASC",
      [slug]
    );

    if (!r || !r.rows || r.rows.length === 0) {
      return res.status(404).json({ error: 'No pricing tiers found', slug: slug });
    }

    var selectedTier = null;
    for (var i = 0; i < r.rows.length; i++) {
      var tier = r.rows[i];
      var minU = parseInt(tier.min_usage, 10) || 0;
      var maxU = parseInt(tier.max_usage, 10) || 0;
      if (maxU === 0) maxU = 999999999;
      if (tokens >= minU && tokens <= maxU) {
        selectedTier = tier;
        break;
      }
    }
    if (!selectedTier) selectedTier = r.rows[r.rows.length - 1];

    var unitPrice = parseFloat(selectedTier.price) || 0;
    var totalCost = unitPrice * tokens;

    res.json({
      model: { slug: slug, name: r.rows[0].name },
      tokens_requested: tokens,
      matched_tier: selectedTier.tier_name,
      pricing_model: selectedTier.pricing_model,
      currency: selectedTier.currency,
      unit_price: unitPrice,
      total_cost: totalCost,
      available_tiers: r.rows.length
    });
  } catch (e) {
    console.error('[cost-calculate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ===== 3. BENCHMARKS ===== */
app.get('/api/intelligence/benchmarks', async function(req, res) {
  try {
    var slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: 'slug query param is required' });

    var r = await getPool().query(
      "SELECT m.slug, m.name, b.benchmark_definition_id, b.score, b.percentile, b.sample_count, b.measured_at FROM model_benchmarks b JOIN models m ON b.model_id = m.id WHERE m.slug = $1 ORDER BY b.measured_at DESC",
      [slug]
    );

    if (!r || !r.rows) return res.status(500).json({ error: 'Query failed' });

    res.json({
      model: slug,
      benchmark_count: r.rows.length,
      benchmarks: r.rows
    });
  } catch (e) {
    console.error('[benchmarks]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ===== 4. COMPARE ===== */
app.get('/api/intelligence/compare', async function(req, res) {
  try {
    var slugs = req.query.slugs;
    if (!slugs) return res.status(400).json({ error: 'slugs query param required (comma-separated)' });

    var slugList = slugs.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
    if (slugList.length < 2) return res.status(400).json({ error: 'At least 2 slugs required' });
    if (slugList.length > 5) return res.status(400).json({ error: 'Max 5 slugs allowed' });

    var mr = await getPool().query(
      "SELECT id, slug, name, model_type, parameter_count, context_window, is_open_source, status FROM models WHERE slug = ANY($1)",
      [slugList]
    );

    if (!mr || !mr.rows || mr.rows.length === 0) {
      return res.status(404).json({ error: 'No models found', slugs: slugList });
    }

    var results = [];
    for (var i = 0; i < mr.rows.length; i++) {
      var model = mr.rows[i];
      var br = await getPool().query(
        "SELECT benchmark_definition_id, score, percentile FROM model_benchmarks WHERE model_id = $1",
        [model.id]
      );
      results.push({
        slug: model.slug,
        name: model.name,
        model_type: model.model_type,
        parameter_count: model.parameter_count,
        context_window: model.context_window,
        is_open_source: model.is_open_source,
        status: model.status,
        benchmark_count: (br && br.rows) ? br.rows.length : 0,
        benchmarks: (br && br.rows) ? br.rows : []
      });
    }

    res.json({ compared: results.length, models: results });
  } catch (e) {
    console.error('[compare]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ===== 5. SAFETY / CAPABILITIES ===== */
app.get('/api/intelligence/safety/:slug', async function(req, res) {
  try {
    var slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: 'slug is required' });

    var r = await getPool().query(
      "SELECT m.slug, m.name, c.capability, c.description, c.details FROM model_capabilities c JOIN models m ON c.model_id = m.id WHERE m.slug = $1",
      [slug]
    );

    if (!r || !r.rows || r.rows.length === 0) {
      return res.status(404).json({ error: 'No capabilities found', slug: slug });
    }

    res.json({
      model: { slug: slug, name: r.rows[0].name },
      capability_count: r.rows.length,
      capabilities: r.rows
    });
  } catch (e) {
    console.error('[safety]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ===== START ===== */
app.listen(PORT, function() {
  console.log('TRUNKIA Phase3 on :' + PORT);
});
