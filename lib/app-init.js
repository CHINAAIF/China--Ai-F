// lib/app-init.js
// TRUNKIA - Application Initialization Module
// Team: Infrastructure & Security
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { scraperGuard } from '../botDefense.js';

var app = express();
app.set('trust proxy', 1);

/* ===== SECURITY: Helmet ===== */
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"] } },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

/* ===== SECURITY: CORS ===== */
app.use(cors({
  origin: function(origin, callback) {
    var allowed = (process.env.CORS_ORIGINS || '*').split(',').map(function(s) { return s.trim(); });
    if (allowed.indexOf('*') !== -1 || !origin || allowed.indexOf(origin) !== -1) { callback(null, true); }
    else { callback(new Error('CORS blocked')); }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  maxAge: 86400
}));

/* ===== SECURITY: Rate Limiting ===== */
var globalLimiter = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Rate limit exceeded', retry_after: 60 } });
app.use('/api/', globalLimiter);

var strictLimiter = rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Strict rate limit exceeded', retry_after: 60 } });
app.use('/api/self-heal/', strictLimiter);
app.use('/api/scheduler/trigger/', strictLimiter);

/* ===== SECURITY: Body Size ===== */
app.use(express.json({ limit: '100kb' }));
app.use(scraperGuard);
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

/* ===== MIDDLEWARE: Request Tracking ===== */
app.use(function(req, res, next) {
  var start = Date.now();
  var rid = Math.random().toString(36).substring(2, 10);
  req._startTime = start; req._requestId = rid;
  res.setHeader('x-request-id', rid);
  res.setHeader('x-powered-by', 'TRUNKIA');
  res.removeHeader('X-Powered-By');
  var origEnd = res.end;
  res.end = function(chunk, enc) { res.setHeader('x-response-time', (Date.now() - start) + 'ms'); origEnd.call(res, chunk, enc); };
  next();
});

/* ===== ERROR HANDLER ===== */
app.use(function(err, req, res, next) {
  if (err.message === 'CORS blocked') return res.status(403).json({ error: 'Forbidden', request_id: req._requestId });
  console.error('[UNCAUGHT]', err.message);
  res.status(500).json({ error: 'Internal error', request_id: req._requestId || 'unknown' });
});

export default app;
