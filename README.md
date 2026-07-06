# TRUNKIA
## Global AI Model Navigator

> Transparency. Comparison. Mastery.

TRUNKIA is an independent AI model intelligence platform.
We help you discover, compare, and master AI models from around the world.

### What We Offer
- **Model Comparison**: Side-by-side comparison of global AI models
- **Pricing Intelligence**: Real-time pricing and cost analysis
- **Performance Benchmarks**: Objective performance data
- **Learning Resources**: Guides, prompts, and tutorials
- **Open Source Directory**: Curated list of open-source models

### Disclaimer
Independent platform. Not affiliated with any government or AI company.
All data sourced from publicly available information.

### API
Base URL: https://web-production-d41fb.up.railway.app
- GET / — Platform info
- GET /health — System health
- GET /api/sovereign/status — System status

## 🌐 Environment Management (Production vs Staging)

This project enforces strict environment isolation. The system will fail-fast and refuse to start if mandatory secrets are missing.

### Architecture
- **Production Database:** Neon Project `china_Ai_F` (Branch: `production`)
- **Staging Database:** Neon Project `china_Ai_F` (Branch: `staging`)
- **Runtime:** Local Node.js (Termux/Android) or Railway. No shared databases.

### How to Run Locally

1. **Staging (Testing):**
   ```bash
   npm run start:staging
   ```
   *(This loads `.env.staging` which points to the isolated Neon `staging` branch)*

2. **Production (Live):**
   ```bash
   npm run start:production
   ```
   *(This loads `.env.production` which points to the Neon `production` branch)*

### Switching Environments
To switch environments, simply use the corresponding npm script. The `config/env.js` loader automatically validates all required database URLs and encryption keys before allowing the application to start.

## 🛡️ Penetration Testing Environment
The `staging` environment (Neon Branch: `staging`) is completely isolated from `production` data. It uses a restricted database role (`app_user`) with strict Row Level Security (RLS) policies. This environment is designated for independent security penetration testing and vulnerability assessments. No testing should be conducted on the `production` branch.
