require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const Groq = require('groq-sdk');

const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static('public'));

// ── FILE PARSE ────────────────────────────────────────
app.post('/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const { mimetype, originalname, buffer } = req.file;
  try {
    let text = '';
    if (mimetype === 'application/pdf' || originalname.endsWith('.pdf')) {
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      originalname.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (mimetype === 'text/plain' || originalname.endsWith('.txt')) {
      text = buffer.toString('utf-8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, or TXT.' });
    }
    text = text.replace(/\r\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
    if (!text) return res.status(400).json({ error: 'Could not extract text from this file.' });
    res.json({ text, filename: originalname });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'File parsing failed: ' + err.message });
  }
});

// ── SCREEN ────────────────────────────────────────────
const STRICTNESS = {
  1: 'Be lenient. Advance candidates who meet at least 60% of the requirements. Give the benefit of the doubt on ambiguous experience.',
  2: 'Be balanced. Advance candidates who clearly meet approximately 75% of the requirements.',
  3: 'Be strict. Only advance candidates who strongly meet 85% or more of the requirements with clear, specific evidence in their resume.',
};

app.post('/screen', async (req, res) => {
  const { jobDescription, resume, strictness = 2 } = req.body;
  if (!jobDescription?.trim() || !resume?.trim()) {
    return res.status(400).json({ error: 'Both job description and resume are required.' });
  }
  const prompt = `You are an expert hiring assistant. Analyze the resume against the job description and return a structured screening result.

SCREENING STRICTNESS: ${STRICTNESS[strictness] || STRICTNESS[2]}

JOB DESCRIPTION:
${jobDescription}

RESUME:
${resume}

Respond with ONLY valid JSON in this exact format:
{
  "decision": "ADVANCE" or "REJECT",
  "confidence": "High", "Medium", or "Low",
  "resume_score": <0-100 composite score weighted as: skills match 30%, experience relevance 25%, keyword/terminology alignment 15%, education fit 15%, career trajectory 10%, resume professionalism 5%. Be precise and critical.>,
  "summary": "One paragraph (3-4 sentences) the recruiter can paste into their notes.",
  "scores": {
    "skills_match": <0-100>,
    "experience_level": <0-100>,
    "education_fit": <0-100>,
    "overall_fit": <0-100>
  },
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "gaps": ["gap 1", "gap 2", "gap 3"],
  "decision_reason": "One sentence explaining the top reason for this decision."
}`;
  const start = Date.now();
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const result = JSON.parse(completion.choices[0].message.content);
    result.screening_time_seconds = elapsed;
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Screening failed. Check your API key and try again.' });
  }
});

// ── INTERVIEW QUESTIONS ───────────────────────────────
app.post('/questions', async (req, res) => {
  const { jobDescription, resume, candidateName } = req.body;
  if (!jobDescription?.trim() || !resume?.trim()) {
    return res.status(400).json({ error: 'Job description and resume are required.' });
  }
  const prompt = `You are a senior hiring manager preparing for an interview with ${candidateName || 'a candidate'}.

JOB DESCRIPTION:
${jobDescription}

CANDIDATE RESUME:
${resume}

Generate 7 tailored interview questions. Each should probe something specific from this candidate's background — not generic questions. Mix behavioral, technical, and situational. Flag any resume gaps worth probing.

Respond with ONLY valid JSON:
{
  "questions": [
    { "category": "Technical Skills", "question": "...", "why": "One sentence on why this question matters for this candidate." },
    { "category": "Experience", "question": "...", "why": "..." },
    { "category": "Behavioral", "question": "...", "why": "..." },
    { "category": "Gap Probe", "question": "...", "why": "..." },
    { "category": "Situational", "question": "...", "why": "..." },
    { "category": "Culture Fit", "question": "...", "why": "..." },
    { "category": "Closing", "question": "...", "why": "..." }
  ]
}`;
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });
    const result = JSON.parse(completion.choices[0].message.content);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Question generation failed.' });
  }
});

// ── EMAIL DRAFT ───────────────────────────────────────
app.post('/email', async (req, res) => {
  const { candidateName, jobTitle, decision, decisionReason, summary } = req.body;
  if (!candidateName || !decision) {
    return res.status(400).json({ error: 'Candidate name and decision are required.' });
  }
  const isAdvance = decision === 'advanced';
  const prompt = `Write a professional, warm, and concise ${isAdvance ? 'interview invitation' : 'rejection'} email for a job application.

Candidate Name: ${candidateName}
Role: ${jobTitle || 'the position'}
Decision: ${isAdvance ? 'Move forward to interview' : 'Not moving forward'}
${decisionReason ? `Key reason: ${decisionReason}` : ''}
${summary ? `Screening summary: ${summary}` : ''}

Requirements:
- Professional but human tone
- ${isAdvance ? 'Invite them to schedule an interview, express genuine enthusiasm' : 'Polite and respectful, no specific reasons given, encourage them to apply in future'}
- 3-5 sentences max
- Leave [YOUR NAME] and [COMPANY NAME] as placeholders
- Do NOT mention AI screening

Respond with ONLY valid JSON:
{
  "subject": "Email subject line",
  "body": "Full email body with greeting and sign-off"
}`;
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      response_format: { type: 'json_object' },
    });
    const result = JSON.parse(completion.choices[0].message.content);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Email generation failed.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Job Screener running at http://localhost:${PORT}`));
