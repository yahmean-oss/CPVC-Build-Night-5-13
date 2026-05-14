# Job Application Screener

AI-powered resume screener built for CPVC Build Night — May 13, 2026.

Paste a job description and a resume. Get an instant Advance/Reject recommendation with category scores, strengths & gaps, and a recruiter-ready summary.

## Setup

**Requirements:** Node.js installed

```bash
# 1. Clone and enter the project
cd job-screener

# 2. Install dependencies
npm install

# 3. Add your Groq API key
cp .env.example .env
# Open .env and replace with your actual key

# 4. Run
npm start
```

Open http://localhost:3000 in your browser.

## The Business Case

- Manual resume review: ~3 minutes per candidate
- This tool: ~3–5 seconds per candidate
- At 200 applicants: saves ~9.5 hours of recruiter time per role
- At $35/hr loaded cost: **~$330 saved per open role**

## Tech Stack

- Node.js + Express
- Groq API (Llama 3.3 70B)
- Vanilla HTML/CSS/JS
